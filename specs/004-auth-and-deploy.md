# 004: Auth and deployment on AWS

Status: approved

## Problem

The sync API from spec 003 runs only on a laptop, with a development stand-in for users. This spec puts it on AWS behind real authentication, following ADRs 0002 (Lambda container image), 0003 (Neon Postgres) and 0004 (Cognito), so the phone can sync in spec 005.

## Behavior

1. The API is reachable over HTTPS at an API Gateway URL in eu-central-1.
2. `health.check` answers without a token. `sync.push` and `sync.pull` need a valid Cognito ID or access token from Savor's user pool; without one, API Gateway answers 401 before the Lambda runs.
3. The Lambda takes the user id only from the verified token's `sub` claim. The `x-dev-user-id` stand-in never works in AWS.
4. A push to `main` that changes the API or shared code builds a new image, runs database migrations on Neon, and updates the Lambda, with no AWS keys stored in GitHub.
5. Infrastructure changes are planned and applied by hand from the developer's machine, after reviewing the plan.
6. A weekly scheduled call keeps the Lambda from going inactive (ADR 0002).

## Infrastructure (Terraform, eu-central-1)

`infra/bootstrap` (local state, applied once):
- S3 bucket for Terraform state: versioned, encrypted, public access blocked, named `savor-tfstate-<account id>`. Locking with S3's native lock file (`use_lockfile`, GA since Terraform 1.11; no DynamoDB table).
- GitHub OIDC identity provider and a deploy role that only this repository's `main` branch can assume (`sub` = `repo:Linayoo/savor:ref:refs/heads/main`, so deploy jobs don't use a GitHub environment). Bootstrap creates the role with its trust policy only; its permissions are attached in `infra/app`, next to the resources they name.
- AWS Budget of 5 USD per month with email alerts at 80% and 100%. AWS Budgets verifies a new email recipient: the link must be opened within 12 hours while signed in to the account.
- Personal values (alert email, Neon org id) go in a gitignored `terraform.tfvars`, with a committed `terraform.tfvars.example`.

`infra/app` (remote state in the bucket):
- **Neon:** project in AWS Frankfurt (`aws-eu-central-1`), managed with the community `kislerdm/neon` provider (0.18.0; the one Neon's docs point to, moving to `neondatabase/neon`, which isn't on the registry yet). Every project gets a default database and role; they are named `savor` through the project's `branch` block. History retention is 6 hours (the Free plan maximum; the provider's default of 24 hours fails). `org_id` is set, as Neon recommends. The API key comes from the `NEON_API_KEY` environment variable, never a file. The role password ends up in Terraform state, which is why the state bucket is encrypted and private. Neon Free has no deletion protection: destroying the project deletes the data.
- **Secrets Manager:** one secret holding the Neon connection strings as JSON: `url` (pooled host, for the Lambda) and `migrationUrl` (direct host, since Neon's pooler runs in transaction mode and Neon advises direct connections for migrations).
- **Cognito:** user pool (Essentials tier, the default, set explicitly) with email as username, email verification, a password policy, and deletion protection. One public app client (no secret) for the mobile app with SRP and refresh-token flows. The smoke test signs in with `ALLOW_ADMIN_USER_PASSWORD_AUTH`, which only works with IAM credentials, so the public app itself still can't use anything but SRP and refresh.
- **ECR:** repository for the API image, with a lifecycle policy keeping the last 5 images, scan on push, mutable tags (so a re-run can push the same commit), and a repository policy letting Lambda pull for this function only.
- **Lambda:** container image function, Node 24 base image, **arm64** (built natively on GitHub's `ubuntu-26.04-arm` runner, free for public repositories), 512 MB, 15 s timeout, `NODE_ENV=production`, permission to read only its own secret. CloudWatch log group with 14-day retention. Terraform ignores changes to `image_uri`, since deploys update it.
- **API Gateway HTTP API:** payload format 2.0, a JWT authorizer for the user pool (issuer `https://cognito-idp.eu-central-1.amazonaws.com/<pool id>`, audience the app client id, which accepts ID tokens through `aud` and access tokens through `client_id`), `GET /health.check` without the authorizer, and every other route (`$default`, which also catches batched calls) with it. Default throttling 10 requests/s, burst 20.
- **EventBridge Scheduler:** weekly invocation (`rate(7 days)`) of the Lambda with a `{ "source": "savor.keepwarm" }` payload, through a role that may only invoke this function.
- **Deploy role permissions** (least privilege, an inline policy on the bootstrap role):
  - `ecr:GetAuthorizationToken` on `*` (it can't be scoped to a resource)
  - on the one repository: `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`
  - on the one function: `lambda:UpdateFunctionCode`, `lambda:GetFunctionConfiguration` (polled while waiting for the update)
  - on the one secret: `secretsmanager:GetSecretValue`
  - nothing else: no Terraform state, no IAM.

Terraform (1.16.5) and provider versions (`hashicorp/aws` 6.68.0, `kislerdm/neon` 0.18.0) are pinned, with lock files for macOS and Linux. `terraform fmt -check` and `terraform validate` run in CI for both folders.

## API changes

- `apps/api/src/lambda.ts`: handler using tRPC's `awsLambdaRequestHandler`.
  - The context reads `userId` from `event.requestContext.authorizer.jwt.claims.sub`; no claims, or a `sub` that isn't a non-empty string, means `userId = null`.
  - A `savor.keepwarm` event returns immediately without touching the database. (tRPC's adapter throws on non-HTTP events, so this check comes first.)
  - Reads the connection string from Secrets Manager once per container (a failed read is retried on the next request), and creates and closes a Neon `Pool` per request (ADR 0003).
- `apps/api/Dockerfile`: multi-stage build from the AWS Lambda Node 24 base image. esbuild bundles the handler and all its dependencies, including `@savor/shared`, into one file, which is all the final image contains. Built for one platform with `--provenance=false`, since Lambda rejects multi-platform images.
- `pnpm --filter @savor/api db:migrate`: applies the migrations to `DATABASE_URL`, for deploys.
- The standalone dev server from spec 003 stays as it is.

## Deploy workflow (GitHub Actions)

- A `deploy` job in the CI workflow that needs the check jobs, so it deploys exactly the commit CI tested. It runs on push to `main` when `apps/api`, `packages/shared`, `pnpm-lock.yaml` or the workflow changed, and on manual dispatch from `main`. (A separate workflow on `workflow_run` can't filter by path and deploys the latest commit on `main`, not necessarily the tested one.)
- Runs on `ubuntu-26.04-arm`.
- Assumes the deploy role with OIDC.
- Builds and pushes the image tagged with the commit SHA.
- Runs Drizzle migrations against Neon, reading the connection string from Secrets Manager. If migrations fail, the Lambda is not updated.
- Updates the Lambda to the new image and waits until it is active.
- Runs a smoke check: `GET /health.check` returns `{ ok: true }` (tRPC's body: `{"result":{"data":{"ok":true}}}`).

First deploy: the Lambda needs an image before it can exist, and the deploy job only exists once this spec's code is pushed. So the first deploy runs from the developer's machine, in an order the README documents:
1. Apply `infra/bootstrap` and confirm the budget email.
2. Apply only the ECR repository in `infra/app` (`-target`).
3. Build and push the first image from the developer's machine.
4. Apply the rest of `infra/app` with that image's tag.
5. Run the migrations from the developer's machine.
6. Run the smoke test.

The first deploy job after pushing then proves the pipeline.

## Scripts

- `pnpm --filter @savor/api smoke`: given the API URL, the user pool and client ids, and two test users' credentials (from environment variables), signs in to Cognito with the developer's AWS credentials, and checks:
  - that calls without a token get 401
  - that user A gets back what A pushed
  - that B's pull never contains A's moment
  - that a valid token with a different `x-dev-user-id` acts as the token's user
- README section: how to create the test users with the AWS CLI, and how to run the smoke test.

## Acceptance criteria

- [ ] Given no token, when calling `sync.push` or `sync.pull` on the deployed API, then the response is 401 and the Lambda is not invoked.
- [ ] Given a valid token for user A, when A pushes and pulls, then A gets back what A pushed.
- [ ] Given valid tokens for users A and B, then B's pull never returns A's data.
- [ ] Given a request with `x-dev-user-id` but no token, then it is rejected; given a valid token and a different `x-dev-user-id`, then the token's user is used.
- [ ] `GET /health.check` works without a token.
- [ ] Given a `savor.keepwarm` event, then the handler returns without opening a database connection.
- [ ] Handler unit tests cover: claims to `userId`, missing claims, the keepwarm event, and the dev header being ignored.
- [ ] A push to `main` that changes the API deploys a new image, runs migrations and passes the smoke check, with no long-lived AWS credentials in GitHub.
- [ ] Given a failing migration, then the Lambda keeps running the previous image.
- [ ] The deploy role cannot do anything outside its listed permissions (checked by reading the policy, and by one denied action in the plan review).
- [ ] `terraform fmt -check` and `terraform validate` pass in CI for both folders; `terraform plan` on `infra/app` shows no changes after apply.
- [ ] The budget alarm exists, and its email subscription is confirmed.
- [ ] The smoke script passes against the deployed API.
- [ ] README documents bootstrap, first deploy, creating a test user, running the smoke test, and tearing everything down.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass locally and in CI.

## Out of scope

- App sign-up and sign-in screens, and the phone calling the API (spec 005)
- Photo uploads and S3 (spec 005)
- Custom domain and TLS certificate
- Separate staging environment
- Account deletion (its own spec)
- Alarms beyond the budget

## Open questions

- None.
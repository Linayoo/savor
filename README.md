# Savor

A little app for coming back to the moment and savoring it.

Keep a moment in seconds, with photos and a line. Look back through a timeline and a gallery. Once a month, Savor writes you a short letter from what you kept.

Status: in active development.

## Architecture (planned)

- Mobile: Expo (React Native, TypeScript, Expo Router), local-first
- API: Node, tRPC, Drizzle, Postgres, shared Zod schemas
- Cloud: AWS Lambda (Docker image), API Gateway, S3, Cognito, SQS, EventBridge
- AI: LLM-written monthly letter, enrichment agent with tools (TMDB, image captions, kind suggestions)
- Infrastructure: Terraform
- CI/CD: GitHub Actions, EAS Build to TestFlight

## Repo structure

```
apps/mobile      Expo app
apps/api         tRPC API
packages/shared  Zod schemas and types
infra/           Terraform: bootstrap (state, deploy role, budget) and app
specs/           one spec per feature
docs/adr/        architecture decisions
```

## How it's built

Spec-driven: every feature starts as a spec in `specs/` with acceptance criteria, and larger decisions are recorded as ADRs in `docs/adr/`.

## Getting started

You need Node 24 (`nvm use` picks it up from `.nvmrc`), pnpm through corepack, and Docker for the API.

```
pnpm install
pnpm mobile
```

### API

The API runs locally against Postgres in Docker. `docker compose up -d` starts Postgres 17 on port 5433, with a `savor` database for development and a `savor_test` database for tests.

```
docker compose up -d
pnpm --filter @savor/api dev
```

The dev server applies the migrations and serves tRPC on `http://localhost:3000`. Locally, a development-only `x-dev-user-id` header stands in for the signed-in user. In AWS it is ignored, and the user comes from the Cognito token.

```
curl http://localhost:3000/health.check

curl -X POST http://localhost:3000/sync.push \
  -H 'content-type: application/json' -H 'x-dev-user-id: ana' \
  -d '{"moments":[{"id":"6f1c2c1e-1b7a-4c1e-9d2a-3f4b5c6d7e8f","text":"Ramen","kind":"meal","createdAt":1790847000000,"updatedAt":1790847000000,"deletedAt":null}],"photos":[]}'

curl -G http://localhost:3000/sync.pull -H 'x-dev-user-id: ana' \
  --data-urlencode 'input={"sinceVersion":0}'
```

`pnpm test` needs the same Postgres running, since the API tests use the `savor_test` database.

## Deploying

The API runs on AWS in eu-central-1: a Lambda container image behind an API Gateway HTTP API, Cognito for sign-in, and Neon Postgres (ADRs 0002 to 0004, spec 004). Terraform manages all of it. Infrastructure is planned and applied by hand; code deploys from CI.

You need:
- Terraform 1.16.5 (`tfenv install 1.16.5`)
- the AWS CLI, signed in to Savor's account (`export AWS_PROFILE=savor`)
- Docker
- `jq`
- a Neon API key in the environment (`export NEON_API_KEY=...`), never in a file
- your Neon organization id

### Bootstrap (once)

`infra/bootstrap` holds what everything else needs first:
- the state bucket
- GitHub's OIDC provider and the deploy role
- a 5 USD monthly budget

It keeps its state locally in `infra/bootstrap/terraform.tfstate` (gitignored), so back that file up.

```
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars   # set budget_email
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

AWS Budgets then emails a verification link. Open it within 12 hours while signed in to the account; until then no alerts arrive.

### First deploy

The Lambda needs an image before it can exist, so the first deploy runs from your machine. Run everything from the repo root.

1. Create the image repository on its own:

   ```
   cp infra/app/terraform.tfvars.example infra/app/terraform.tfvars   # set neon_org_id
   terraform -chdir=infra/app init \
     -backend-config="bucket=$(terraform -chdir=infra/bootstrap output -raw state_bucket)"
   terraform -chdir=infra/app apply \
     -target=aws_ecr_repository.api -target=aws_ecr_lifecycle_policy.api
   ```

2. Build and push the first image. Lambda runs it on arm64 and rejects multi-platform images and attestations.

   ```
   REGISTRY="$(aws sts get-caller-identity --query Account --output text).dkr.ecr.eu-central-1.amazonaws.com"
   aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
   docker buildx build --platform linux/arm64 --provenance=false --sbom=false \
     -f apps/api/Dockerfile -t "$REGISTRY/savor-api:$(git rev-parse HEAD)" --push .
   ```

3. Create the rest: Neon, the secret, Cognito, the function, the API, the keepwarm schedule and the deploy role's permissions.

   ```
   terraform -chdir=infra/app plan -out=tfplan
   terraform -chdir=infra/app apply tfplan
   ```

4. Apply the migrations to Neon over its direct connection:

   ```
   DATABASE_URL="$(aws secretsmanager get-secret-value --secret-id savor/database \
     --query SecretString --output text | jq -r .migrationUrl)" \
     pnpm --filter @savor/api db:migrate
   ```

5. Tell the deploy job where to deploy. These are repository variables, not secrets: GitHub signs in to AWS with OIDC and stores no keys.

   ```
   gh variable set AWS_DEPLOY_ROLE_ARN --body "$(terraform -chdir=infra/bootstrap output -raw deploy_role_arn)"
   gh variable set SAVOR_API_URL --body "$(terraform -chdir=infra/app output -raw api_url)"
   ```

From then on, a push to `main` that changes `apps/api`, `packages/shared`, the lockfile or the CI workflow deploys after the checks pass:
- build and push the image tagged with the commit
- run the migrations
- update the function
- check `health.check`

Running the CI workflow by hand on `main` deploys too. If the migrations fail, the function keeps its previous image.

### Test users and the smoke test

The smoke test needs two users. Create each with the AWS CLI, with a password of at least 12 characters that has upper case, lower case and a number:

```
POOL="$(terraform -chdir=infra/app output -raw user_pool_id)"
aws cognito-idp admin-create-user --user-pool-id "$POOL" \
  --username smoke-a@example.com --message-action SUPPRESS \
  --user-attributes Name=email,Value=smoke-a@example.com Name=email_verified,Value=true
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" \
  --username smoke-a@example.com --password '<password>' --permanent
```

Then repeat for `smoke-b@example.com`. Put the credentials in `apps/api/.env.smoke`, which is gitignored:

```
SMOKE_USER_A_EMAIL=smoke-a@example.com
SMOKE_USER_A_PASSWORD=...
SMOKE_USER_B_EMAIL=smoke-b@example.com
SMOKE_USER_B_PASSWORD=...
```

Run it with your AWS profile, since it signs in through Cognito's admin flow:

```
export SAVOR_API_URL="$(terraform -chdir=infra/app output -raw api_url)"
export SAVOR_USER_POOL_ID="$(terraform -chdir=infra/app output -raw user_pool_id)"
export SAVOR_CLIENT_ID="$(terraform -chdir=infra/app output -raw client_id)"
set -a; source apps/api/.env.smoke; set +a
pnpm --filter @savor/api smoke
```

It checks five things:
- calls without a valid token get 401
- A gets back what A pushed
- B's pull never contains A's moment
- an `x-dev-user-id` header naming B doesn't change who A is
- both ID and access tokens work

At the end it deletes the moment it pushed.

### Tearing down

The user pool has deletion protection, and destroying the Neon project deletes the data with it.

1. Set `deletion_protection = "INACTIVE"` in `infra/app/auth.tf`, then:

   ```
   terraform -chdir=infra/app apply
   terraform -chdir=infra/app destroy
   ```

   The secret is deleted after a 7-day recovery window. To reuse the name sooner:

   ```
   aws secretsmanager delete-secret --secret-id savor/database --force-delete-without-recovery
   ```

2. The state bucket is versioned, so empty every version before destroying bootstrap. A state bucket holds far fewer than the 1,000 objects one call can delete.

   ```
   BUCKET="$(terraform -chdir=infra/bootstrap output -raw state_bucket)"
   aws s3api delete-objects --bucket "$BUCKET" --delete "$(aws s3api list-object-versions \
     --bucket "$BUCKET" --output json \
     --query '{Objects: [Versions[], DeleteMarkers[]][].{Key: Key, VersionId: VersionId}}')"
   terraform -chdir=infra/bootstrap destroy
   gh variable delete AWS_DEPLOY_ROLE_ARN
   gh variable delete SAVOR_API_URL
   ```

## Roadmap

- [x] Core app: keep moments with photos, timeline, gallery, full-screen viewer, edit, delete
- [x] M0: monorepo, CI, specs
- [x] M1: moment kinds (first spec-driven feature)
- [ ] M2: backend and sync
  - [x] Local SQLite store with UUIDs and tombstones (spec 002)
  - [x] Shared schemas and local API (spec 003)
  - [ ] Auth and deployment on AWS (spec 004)
  - [ ] Sync and photo uploads (spec 005)
- [ ] M3: monthly letter (LLM API, scheduled)
- [ ] M4: enrichment agent (SQS, tools)
- [ ] M5: TestFlight via CI, demo video
- [ ] M6: ask your moments (RAG, optional)

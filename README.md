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

Code and docs are formatted with Prettier: `pnpm format` formats everything, and CI runs `pnpm format:check`. Expo sometimes rewrites `app.json` or `tsconfig.json` in its own style; `pnpm format` puts them back.

The commit that first formatted the repo is listed in `.git-blame-ignore-revs`. To have `git blame` skip it, run once:

```
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

### Mobile app

The app runs as a development build, not in Expo Go, because Amplify Auth needs its own native module ([ADR 0006](docs/adr/0006-development-build.md)). `ios/` and `android/` are generated and gitignored; native settings live in `apps/mobile/app.json`.

You need Xcode with an iOS simulator. The simulator needs no Apple account.

1. Point the app at the deployed API and user pool. The values are the Terraform outputs `api_url`, `user_pool_id` and `client_id`; none are secrets.

   ```
   cp apps/mobile/.env.example apps/mobile/.env
   ```

2. Build and install the app on a simulator. This takes a few minutes the first time:

   ```
   pnpm --filter @savor/mobile exec expo run:ios
   ```

3. After that, `pnpm mobile` serves the JavaScript with fast refresh. Build again only after adding a native package or changing `app.json`. Restart `pnpm mobile` after changing `.env`.

To test sync with two devices, install the build on a second simulator too:

```
xcrun simctl list devices available
pnpm --filter @savor/mobile exec expo run:ios --device "<name of a second simulator>"
```

Both simulators then load the app from the same `pnpm mobile`. Create an account in the app on one, and sign in with it on the other.

On an iPhone (optional), connect it and run `expo run:ios --device`. Xcode needs a signing team: with a free Apple ID the app stops opening after 7 days and has to be installed again; the paid Apple Developer Program removes that limit.

Moments kept in Expo Go stay in Expo Go: the development build is a different app with its own storage.

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

### Photos

Photos live in a private S3 bucket, `savor-photos-<account id>` (spec 006). The phone uploads and downloads them with presigned URLs from the API, signed with the Lambda's role; nothing else is granted access, apart from your admin user. Terraform creates the bucket and gives the Lambda its name.

`photo-checks` checks the bucket and the photo API against AWS, with the smoke test's users and environment, plus the bucket name:

```
export SAVOR_PHOTOS_BUCKET="$(terraform -chdir=infra/app output -raw photos_bucket)"
pnpm --filter @savor/api photo-checks
```

It checks that:

- the bucket blocks public access, refuses plain HTTP and grants nothing in its policy
- S3 refuses a file over 10 MB, another content type and another key
- B gets nothing for A's photo
- deleting the moment deletes the object

With `pnpm --filter @savor/api photo-checks -- --expiry` it also waits 15 minutes to check that the upload form stops working after 5 minutes and the download URL after 15.

To check a photo uploaded by the phone for location data, download it and read its metadata with `exiftool` (`brew install exiftool`):

```
aws s3 ls "s3://$SAVOR_PHOTOS_BUCKET/users/" --recursive
aws s3 cp "s3://$SAVOR_PHOTOS_BUCKET/<key>" photo.jpg
exiftool photo.jpg
```

The output should have no GPS lines, no camera make or model, and an image size whose longer side is at most 2048.

### Monthly letters

Once a month, the letters Lambda writes a letter from each person's moments with Claude Sonnet 5.5 on Amazon Bedrock, through the EU inference profile (spec 007, ADR 0007). A schedule runs it at 08:00 Zurich time on the 1st, 2nd and 3rd; each run writes only the letters still missing.

Model access, once per account: Bedrock enables a model on its first call, which needs AWS Marketplace permissions and, for Anthropic, a use case form. Do it with your admin user in the Bedrock console, in eu-central-1: open the playground, choose Claude Sonnet 5.5, submit the form if it asks, and send any message. The letters role never gets Marketplace permissions.

To check the roles after `terraform apply`, the letters role may call the profile and the model only through it, and the API role can't call Bedrock:

```
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
PROFILE="arn:aws:bedrock:eu-central-1:$ACCOUNT:inference-profile/eu.anthropic.claude-sonnet-5-5"
MODEL="arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-sonnet-5-5"
check() {
  aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::$ACCOUNT:role/$1" \
    --action-names bedrock:InvokeModel --resource-arns "$2" "${@:3}" \
    --query 'EvaluationResults[0].EvalDecision' --output text
}
check savor-letters "$PROFILE"  # allowed
check savor-letters "$MODEL" --context-entries \
  "ContextKeyName=bedrock:InferenceProfileArn,ContextKeyValues=$PROFILE,ContextKeyType=string"  # allowed
check savor-letters "$MODEL"    # implicitDeny: not through the profile
check savor-letters "arn:aws:bedrock:eu-central-1:$ACCOUNT:inference-profile/global.anthropic.claude-sonnet-5-5"  # implicitDeny
check savor-api "$PROFILE"      # implicitDeny
```

To write a month's letters by hand, for example October 2026, invoke the function and read the summary it returns; its logs hold only counts, reasons and ids:

```
aws lambda invoke --function-name savor-letters --cli-read-timeout 310 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"source":"savor.letters","month":"2026-10"}' /dev/stdout
aws logs tail /aws/lambda/savor-letters --since 15m
```

After the first letters, check the real cost in Cost Explorer, filtered to Amazon Bedrock.

`letter-preview` writes a letter through the real model and prints it, without saving it, for tuning the prompt in `apps/api/src/letters/prompt.ts`. It uses the smoke user A's moments, with the smoke test's environment, and your AWS credentials for Bedrock:

```
pnpm --filter @savor/api letter-preview --month 2026-10
```

Or sample moments from a file, `[{ "date": "2026-10-04T13:00:00+02:00", "kind": "meal", "text": "..." }]`, which needs only the Bedrock credentials:

```
pnpm --filter @savor/api letter-preview --month 2026-10 --file samples.json
```

The month follows your computer's time zone unless you pass `--time-zone Europe/Zurich`. `--dry-run` prints the exact request instead of sending it. Each letter costs about a cent.

### Tearing down

The user pool has deletion protection, and destroying the Neon project deletes the data with it.

1. Empty the photos bucket, since Terraform won't destroy a bucket with objects in it:

   ```
   aws s3 rm "s3://$(terraform -chdir=infra/app output -raw photos_bucket)" --recursive
   ```

2. Set `deletion_protection = "INACTIVE"` in `infra/app/auth.tf`, then:

   ```
   terraform -chdir=infra/app apply
   terraform -chdir=infra/app destroy
   ```

   The secret is deleted after a 7-day recovery window. To reuse the name sooner:

   ```
   aws secretsmanager delete-secret --secret-id savor/database --force-delete-without-recovery
   ```

3. The state bucket is versioned, so empty every version before destroying bootstrap. A state bucket holds far fewer than the 1,000 objects one call can delete.

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
- [x] M2: backend and sync
  - [x] Local SQLite store with UUIDs and tombstones (spec 002)
  - [x] Shared schemas and local API (spec 003)
  - [x] Auth and deployment on AWS (spec 004)
  - [x] Sign-in and moment sync (spec 005)
  - [x] Photo uploads (spec 006)
- [ ] M3: monthly letter (LLM API, scheduled)
- [ ] M4: enrichment agent (SQS, tools)
- [ ] M5: TestFlight via CI, demo video
- [ ] M6: ask your moments (RAG, optional)

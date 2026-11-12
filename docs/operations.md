# Operations

How Savor is deployed and run on AWS: the one-time bootstrap, the first deploy, the checks against the live system, the monthly letters and tearing it all down. For what the system is and how to run it locally, see the [README](../README.md).

All commands run from the repo root unless a step says otherwise. They use your AWS credentials; nothing here is run by CI except where a section says so.

## Deploying

The API runs on AWS in eu-central-1: a Lambda container image behind an API Gateway HTTP API, Cognito for sign-in, and Neon Postgres (ADRs 0002 to 0004, spec 004). Terraform manages all of it. Infrastructure is planned and applied by hand; code deploys from CI.

You need:

- Terraform 1.16.5 (`tfenv install 1.16.5`)
- the AWS CLI, signed in to Savor's account (`export AWS_PROFILE=savor`)
- Docker
- `jq`
- a Neon API key in the environment (`export NEON_API_KEY=...`), never in a file
- your Neon organization id

## Bootstrap (once)

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

## First deploy

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

5. Tell the deploy job where to deploy. These are repository variables, not secrets: GitHub signs in to AWS with OIDC, so no AWS keys are stored in GitHub.

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

## Test users and the smoke test

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

## Photos

Photos live in a private S3 bucket, `savor-photos-<account id>` (spec 006). The phone uploads and downloads them with presigned URLs from the API, signed with the Lambda's role; nothing else is granted access, apart from your admin user. Terraform creates the bucket and gives the Lambda its name.

`photo-checks` checks the bucket and the photo API against AWS, with the smoke test's users and environment, plus the bucket name:

```
export SAVOR_PHOTOS_BUCKET="$(terraform -chdir=infra/app output -raw photos_bucket)"
pnpm --filter @savor/api photo-checks
```

It checks that:

- the bucket blocks public access, refuses plain HTTP and grants nothing in its policy
- S3 refuses a file over 10 MB, another content type and another key
- an upload is tagged `upload=pending` until `confirmUpload` clears the tag, and the bucket expires objects still tagged after 2 days (spec 009)
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

## Monthly letters

Once a month, the letters Lambda writes a letter from each person's moments with Claude on Amazon Bedrock, through an EU inference profile (spec 007, ADR 0007). The model is Terraform's `letter_model_id`: Claude Haiku 4.5 until the account has access to Claude Sonnet 5.5, then `eu.anthropic.claude-sonnet-5-5`. A schedule runs it at 08:00 Zurich time on the 1st, 2nd and 3rd; each run writes only the letters still missing.

Model access, once per account: Bedrock enables a model on its first call, which needs AWS Marketplace permissions and, for Anthropic, a use case form. Do it with your admin user in the Bedrock console, in eu-central-1: open the playground, choose the model, submit the form if it asks, and send any message. The letters role never gets Marketplace permissions.

To check the roles after `terraform apply`, the letters role may call the profile and the model only through it, and the API role can't call Bedrock:

```
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
PROFILE="arn:aws:bedrock:eu-central-1:${ACCOUNT}:inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0"
MODEL="arn:aws:bedrock:eu-west-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
check() {
  aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::${ACCOUNT}:role/$1" \
    --action-names bedrock:InvokeModel --resource-arns "$2" "${@:3}" \
    --query 'EvaluationResults[0].EvalDecision' --output text
}
check savor-letters "$PROFILE"  # allowed
check savor-letters "$MODEL" --context-entries \
  "ContextKeyName=bedrock:InferenceProfileArn,ContextKeyValues=$PROFILE,ContextKeyType=string"  # allowed
check savor-letters "$MODEL"    # implicitDeny: not through the profile
check savor-letters "arn:aws:bedrock:eu-central-1:${ACCOUNT}:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0"  # implicitDeny
check savor-api "$PROFILE"      # implicitDeny
```

To try a letter for a month that has already passed, keep moments with past dates for the smoke user A. `seed-moments` sends them through the deployed API's `sync.push`, as the phone would, from a file in `letter-preview`'s format below. It needs the smoke test's environment and your AWS credentials, and running it again with the same file changes nothing:

```
export SAVOR_API_URL="$(terraform -chdir=infra/app output -raw api_url)"
export SAVOR_USER_POOL_ID="$(terraform -chdir=infra/app output -raw user_pool_id)"
export SAVOR_CLIENT_ID="$(terraform -chdir=infra/app output -raw client_id)"
set -a; source apps/api/.env.smoke; set +a
pnpm --filter @savor/api seed-moments --file ~/savor-samples.json
```

To seed your own account instead, for example the one on your iPhone, put its sign-in in `apps/api/.env.seed`, which is gitignored, and source it before running the command:

```
SEED_EMAIL=you@example.com
SEED_PASSWORD=...
```

```
set -a; source apps/api/.env.seed; set +a
```

Otherwise, sign in as the smoke user A on a fresh simulator (Device > Erase All Content and Settings, or a new one) and turn on Monthly letter. A simulator whose moments belong to another account refuses the smoke user: "This phone holds moments from another account."

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

## Releasing the iOS app

The release app, "Savor" (`com.linayoo.savor`), is built and signed on EAS and uploaded to TestFlight by [`release-mobile.yml`](../.github/workflows/release-mobile.yml) (spec 008). Local builds are "Savor Dev" (`com.linayoo.savor.dev`), so both fit on one iPhone with separate data. Run the `eas` commands from `apps/mobile`, where `pnpm eas` uses the eas-cli version in its `package.json`.

### One-time setup

1. In App Store Connect, the app record "Savor: Moments" exists for `com.linayoo.savor`. Its Apple ID (App Information > General Information) is the `ascAppId` in `apps/mobile/eas.json`. Under TestFlight > Internal Testing, create the group `Internal` with yourself in it and automatic distribution on.

2. Create an App Store Connect API key: Users and Access > Integrations > App Store Connect API > Team Keys > **+**, named `EAS Submit`, with the App Manager role. Download the `.p8` once and keep it outside the repo, for example in `~/Keys/`. Note its Key ID and the Issuer ID.

3. Link the Expo project, once (already done: `@savorthemoment/savor`, whose id is in `app.config.ts`):

   ```
   pnpm eas login
   pnpm eas init
   ```

4. Store the app's configuration as EAS environment variables for production builds. They're the same values as `apps/mobile/.env`, none of them secret:

   ```
   pnpm eas env:set --environment production --visibility plaintext --name EXPO_PUBLIC_API_URL --value "$(terraform -chdir=../../infra/app output -raw api_url)"
   pnpm eas env:set --environment production --visibility plaintext --name EXPO_PUBLIC_USER_POOL_ID --value "$(terraform -chdir=../../infra/app output -raw user_pool_id)"
   pnpm eas env:set --environment production --visibility plaintext --name EXPO_PUBLIC_USER_POOL_CLIENT_ID --value "$(terraform -chdir=../../infra/app output -raw client_id)"
   ```

5. Set up signing and the API key in EAS, signing in with your Apple ID when asked:

   ```
   pnpm eas credentials --platform ios
   ```

   Choose the `production` profile, then:
   - Build Credentials: set up all, which creates the distribution certificate and provisioning profile;
   - App Store Connect: Manage your API Key > add a new key > use an existing one, with the `.p8` path, Key ID and Issuer ID;
   - Set up your project to use an API Key for EAS Submit.

   The workflow runs non-interactively, so it can't create any of these itself.

6. On expo.dev, in the account's settings, create a robot user `github-release` with the Developer role, then an access token for it. Save it as the workflow's only secret; `gh` asks for the value, so it stays out of your shell history:

   ```
   gh secret set EXPO_TOKEN
   ```

### Before the first install on an iPhone

A development build installed before spec 008 has the release bundle identifier, `com.linayoo.savor`. Installing from TestFlight would replace it and keep its data. Rebuild it first as "Savor Dev" (`pnpm --filter @savor/mobile ios --device`), then delete the old "savor" app, then install from TestFlight.

### Releasing

Raise `version` in `apps/mobile/package.json` for a new version, then push a tag with that version. Annotate it (`git tag -a`) if you want release notes in git; it isn't required:

```
git tag mobile-v1.0.0
git push origin mobile-v1.0.0
```

The workflow fails before building if the tag's version isn't the app's or if a check fails. EAS then builds, increments the build number and submits; the build appears in TestFlight once Apple has processed it. Write the "What to Test" note in App Store Connect, under TestFlight, on the build. EAS sends that note only on its Enterprise plan.

## Tearing down

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

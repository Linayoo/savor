import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { cognitoAccountDirectory } from "./accounts/cognito-directory";
import { unavailableAccountDirectory } from "./accounts/directory";
import { createDb } from "./db/client";
import { createHandler } from "./handler";
import { s3PhotoStorage } from "./photos/s3-storage";
import { unavailablePhotoStorage } from "./photos/storage";
import { readDatabaseUrl } from "./secret";

// The Lambda entry point, bundled into the container image (Dockerfile).
// infra/app sets DATABASE_SECRET_ID to the secret holding the Neon urls.
const secretId = process.env.DATABASE_SECRET_ID;
if (!secretId) throw new Error("DATABASE_SECRET_ID is not set");

const secrets = new SecretsManagerClient({});

// The photos bucket (infra/app/photos.tf). Without it, sync still works and
// only the photo procedures fail, so an image deployed before the Terraform
// change doesn't take the API down.
const photosBucket = process.env.PHOTOS_BUCKET;
const photosRegion = process.env.PHOTOS_BUCKET_REGION;
if (!photosBucket || !photosRegion) {
  console.error("PHOTOS_BUCKET or PHOTOS_BUCKET_REGION is not set");
}
const photos =
  photosBucket && photosRegion
    ? s3PhotoStorage(new S3Client({ region: photosRegion }), photosBucket)
    : unavailablePhotoStorage;

// Savor's user pool (infra/app/auth.tf), for account deletion (spec 010).
// Without it only account.delete fails, as with the photos bucket above.
const userPoolId = process.env.COGNITO_USER_POOL_ID;
if (!userPoolId) console.error("COGNITO_USER_POOL_ID is not set");
const accounts = userPoolId
  ? cognitoAccountDirectory(new CognitoIdentityProviderClient({}), userPoolId)
  : unavailableAccountDirectory;

export const handler = createHandler({
  getDatabaseUrl: () => readDatabaseUrl(secrets, secretId),
  createDb: (url) => createDb(url, "neon"),
  photos,
  accounts,
});

import {
  AdminInitiateAuthCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

// What the smoke test and the photo checks share: the deployed API's
// address, sign-in for the two test users with Cognito's admin flow (AWS
// credentials for Savor's account), and plain tRPC calls over HTTP.

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const apiUrl = env("SAVOR_API_URL").replace(/\/$/, "");
const userPoolId = env("SAVOR_USER_POOL_ID");
const clientId = env("SAVOR_CLIENT_ID");

const cognito = new CognitoIdentityProviderClient({});

export async function signIn(prefix: "SMOKE_USER_A" | "SMOKE_USER_B") {
  const { AuthenticationResult: tokens } = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: env(`${prefix}_EMAIL`),
        PASSWORD: env(`${prefix}_PASSWORD`),
      },
    }),
  );
  if (!tokens?.IdToken || !tokens.AccessToken) {
    throw new Error(`${prefix} didn't get tokens; is the password permanent?`);
  }
  return {
    idToken: tokens.IdToken,
    accessToken: tokens.AccessToken,
    sub: subOf(tokens.IdToken),
  };
}

// Only to name the user in a header; the API verifies tokens, not this
function subOf(jwt: string): string {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString()).sub;
}

type Call = {
  token?: string;
  input?: unknown;
  headers?: Record<string, string>;
};

export async function query(
  path: string,
  { token, input, headers }: Call = {},
) {
  const search =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  return send(`${path}${search}`, { method: "GET" }, token, headers);
}

export async function mutation(path: string, { token, input, headers }: Call) {
  return send(
    path,
    { method: "POST", body: JSON.stringify(input) },
    token,
    headers,
  );
}

async function send(
  path: string,
  init: RequestInit,
  token?: string,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${apiUrl}/${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
      ...headers,
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

export function pass(check: string) {
  console.log(`ok  ${check}`);
}

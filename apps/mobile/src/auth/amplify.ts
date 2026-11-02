import { Amplify } from "aws-amplify";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { appConfig } from "../config";
import { SecureTokenStorage } from "./secure-storage";

let configured = false;

// Points Amplify at Savor's user pool, with tokens in secure storage. Runs
// once, before the first auth call.
export function configureAuth() {
  if (configured) return;
  const { userPoolId, userPoolClientId } = appConfig();
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: { email: true },
        signUpVerificationMethod: "code",
      },
    },
  });
  cognitoUserPoolsTokenProvider.setKeyValueStorage(new SecureTokenStorage());
  configured = true;
}

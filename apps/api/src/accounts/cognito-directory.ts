import {
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  type CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import type { AccountDirectory } from "./directory";

// Savor's user pool (infra/app/auth.tf). Sign-in is by email, so a user's
// username is a generated id; the sub is accepted in its place. The API's
// role may make these two calls on this pool only (function.tf).
export function cognitoAccountDirectory(
  client: CognitoIdentityProviderClient,
  userPoolId: string,
): AccountDirectory {
  const send = async (
    command: AdminUserGlobalSignOutCommand | AdminDeleteUserCommand,
  ) => {
    try {
      await client.send(command as AdminDeleteUserCommand);
    } catch (error) {
      if ((error as { name?: string }).name === "UserNotFoundException") return;
      throw error;
    }
  };
  return {
    signOutEverywhere: (userId) =>
      send(
        new AdminUserGlobalSignOutCommand({
          UserPoolId: userPoolId,
          Username: userId,
        }),
      ),
    deleteUser: (userId) =>
      send(
        new AdminDeleteUserCommand({
          UserPoolId: userPoolId,
          Username: userId,
        }),
      ),
  };
}

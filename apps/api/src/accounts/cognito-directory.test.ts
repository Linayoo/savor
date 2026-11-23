import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it, vi } from "vitest";
import { cognitoAccountDirectory } from "./cognito-directory";

const userPoolId = "eu-central-1_EXAMPLE";
const sub = "6f1c2c1e-1b7a-4c1e-9d2a-3f4b5c6d7e8f";

function client() {
  return new CognitoIdentityProviderClient({
    region: "eu-central-1",
    credentials: { accessKeyId: "ASIAEXAMPLE", secretAccessKey: "secret" },
  });
}

const commandOf = (send: ReturnType<typeof vi.spyOn>) => {
  const [command] = send.mock.calls[0] as [
    { constructor: { name: string }; input: unknown },
  ];
  return { name: command.constructor.name, input: command.input };
};

const userNotFound = Object.assign(new Error("User does not exist."), {
  name: "UserNotFoundException",
});

describe.each([
  ["signOutEverywhere", "AdminUserGlobalSignOutCommand"],
  ["deleteUser", "AdminDeleteUserCommand"],
] as const)("%s", (method, command) => {
  it(`sends ${command} for the sub in Savor's user pool`, async () => {
    const cognito = client();
    const send = vi.spyOn(cognito, "send").mockResolvedValue({} as never);

    await cognitoAccountDirectory(cognito, userPoolId)[method](sub);

    expect(commandOf(send)).toEqual({
      name: command,
      input: { UserPoolId: userPoolId, Username: sub },
    });
  });

  it("counts a user that's already gone as done", async () => {
    const cognito = client();
    vi.spyOn(cognito, "send").mockRejectedValue(userNotFound);

    await expect(
      cognitoAccountDirectory(cognito, userPoolId)[method](sub),
    ).resolves.toBeUndefined();
  });

  it("passes other errors on, so the deletion can be tried again", async () => {
    const cognito = client();
    vi.spyOn(cognito, "send").mockRejectedValue(
      Object.assign(new Error("Slow down"), {
        name: "TooManyRequestsException",
      }),
    );

    await expect(
      cognitoAccountDirectory(cognito, userPoolId)[method](sub),
    ).rejects.toThrow("Slow down");
  });
});

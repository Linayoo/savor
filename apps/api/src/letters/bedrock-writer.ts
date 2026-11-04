import {
  type BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { buildLetterRequest, checkLetter } from "./prompt";
import type { LetterWriter } from "./writer";

// Sends the built request and returns the model's reply, unchecked. Throws
// when Bedrock refuses or can't be reached.
export async function invokeLetterModel(
  client: BedrockRuntimeClient,
  modelId: string,
  input: Parameters<LetterWriter["write"]>[0],
): Promise<unknown> {
  const response = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(buildLetterRequest(input, modelId)),
    }),
  );
  return JSON.parse(new TextDecoder().decode(response.body));
}

// Writes through Bedrock with the Lambda role's credentials, which may invoke
// only this inference profile and its models (infra/app/letters.tf). A reply
// that fails the checks is a result, not an error.
export function bedrockLetterWriter(
  client: BedrockRuntimeClient,
  modelId: string,
): LetterWriter {
  return {
    model: modelId,
    write: async (input) =>
      checkLetter(await invokeLetterModel(client, modelId, input)),
  };
}

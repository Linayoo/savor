import {
  type BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { buildLetterRequest, checkLetter } from "./prompt";
import type { LetterWriter } from "./writer";

// Writes through Bedrock with the Lambda role's credentials, which may invoke
// only this inference profile and its models (infra/app/letters.tf). Throws
// when Bedrock refuses or can't be reached; a reply that fails the checks is
// a result, not an error.
export function bedrockLetterWriter(
  client: BedrockRuntimeClient,
  modelId: string,
): LetterWriter {
  return {
    model: modelId,
    async write(input) {
      const response = await client.send(
        new InvokeModelCommand({
          modelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify(buildLetterRequest(input)),
        }),
      );
      return checkLetter(JSON.parse(new TextDecoder().decode(response.body)));
    },
  };
}

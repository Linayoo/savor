import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";
import { bedrockLetterWriter } from "./bedrock-writer";
import { buildLetterRequest, type LetterMoment } from "./prompt";

const modelId = "eu.anthropic.claude-haiku-4-5-20251001-v1:0";
const letter = Array.from({ length: 120 }, () => "light").join(" ");

type Sent = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
};

// A real client whose requests stop at a stub instead of the network, so the
// test sees what would be sent
function client(status: number, reply: unknown) {
  const sent: Sent[] = [];
  const bedrock = new BedrockRuntimeClient({
    region: "eu-central-1",
    credentials: { accessKeyId: "ASIAEXAMPLE", secretAccessKey: "secret" },
    maxAttempts: 1,
    requestHandler: {
      handle: async (request: Sent & { body: string }) => {
        sent.push({
          method: request.method,
          path: request.path,
          headers: request.headers,
          body: request.body,
        });
        return {
          response: {
            statusCode: status,
            headers: { "content-type": "application/json" },
            body: new TextEncoder().encode(JSON.stringify(reply)),
          },
        };
      },
    },
  });
  return { bedrock, sent };
}

const input = {
  month: "2026-10",
  timeZone: "Europe/Zurich",
  moments: [
    {
      createdAt: Date.UTC(2026, 9, 4, 12),
      kind: "meal",
      text: "Ramen with Ana",
    },
  ] satisfies LetterMoment[],
};

describe("bedrockLetterWriter", () => {
  it("sends exactly the built request to the inference profile, and checks the reply", async () => {
    const { bedrock, sent } = client(200, {
      content: [{ type: "text", text: letter }],
      stop_reason: "end_turn",
      usage: { input_tokens: 980, output_tokens: 160 },
    });

    const result = await bedrockLetterWriter(bedrock, modelId).write(input);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "POST",
      path: `/model/${encodeURIComponent(modelId)}/invoke`,
      headers: expect.objectContaining({
        "content-type": "application/json",
        accept: "application/json",
      }),
    });
    expect(JSON.parse(sent[0].body)).toEqual(
      buildLetterRequest(input, modelId),
    );
    expect(result).toEqual({
      ok: true,
      body: letter,
      inputTokens: 980,
      outputTokens: 160,
    });
  });

  it("names its model", () => {
    expect(bedrockLetterWriter(client(200, {}).bedrock, modelId).model).toBe(
      modelId,
    );
  });

  it("returns a refusal as a failed check", async () => {
    const { bedrock } = client(200, {
      content: [],
      stop_reason: "refusal",
      usage: { input_tokens: 980, output_tokens: 0 },
    });

    expect(await bedrockLetterWriter(bedrock, modelId).write(input)).toEqual({
      ok: false,
      reason: "refusal",
    });
  });

  it("throws when Bedrock refuses the request", async () => {
    const { bedrock } = client(403, {
      message:
        "You don't have access to the model with the specified model ID.",
    });

    await expect(
      bedrockLetterWriter(bedrock, modelId).write(input),
    ).rejects.toThrow("don't have access");
  });
});

import Anthropic from "@anthropic-ai/sdk";
import type { LlmDriver } from "./types";

const anthropicDriver: LlmDriver = async ({ apiKey, model, messages, system, stream }) => {
  const client = new Anthropic({ apiKey });

  if (stream) {
    const responseStream = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(chunk.delta.text));
            }
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });
    return { stream: readable };
  }

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return { text };
};

export default anthropicDriver;

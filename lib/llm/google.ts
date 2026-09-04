import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LlmDriver } from "./types";

const googleDriver: LlmDriver = async ({ apiKey, model, messages, system, stream }) => {
  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({ 
    model, 
    systemInstruction: system ? { parts: [{ text: system }], role: "system" } : undefined 
  });

  // Gemini's chat API takes history separately from the final message. Also,
  // startChat() throws "First content should be with role 'user'" if history
  // starts with an assistant turn (e.g. a seeded assistant greeting as message 0)
  // — confirmed via a real end-to-end call with a live key, not a guess. Trim any
  // leading assistant turns before mapping.
  const trimmed = [...messages];
  while (trimmed.length && trimmed[0].role === "assistant") trimmed.shift();

  const history = trimmed.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content }],
  }));
  const last = trimmed[trimmed.length - 1];

  const chat = genModel.startChat({ history });

  if (stream) {
    const resultStream = await chat.sendMessageStream(last?.content ?? "");
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of resultStream.stream) {
            controller.enqueue(encoder.encode(chunk.text()));
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });
    return { stream: readable };
  }

  const result = await chat.sendMessage(last?.content ?? "");
  const text = result.response.text();

  return { text };
};

export default googleDriver;

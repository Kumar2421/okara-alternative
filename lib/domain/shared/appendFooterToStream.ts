/** Appends a fixed text chunk after a generation stream closes — used to add
 * the real "no Tavily key configured" notice to Competitor Analysis / Content
 * Strategy without buffering the whole response (which would kill the live
 * "model is writing" streaming effect for the common case). */
export function appendFooterToStream(stream: ReadableStream<Uint8Array>, footer: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    flush(controller) {
      controller.enqueue(encoder.encode(footer));
    },
  });
  return stream.pipeThrough(transform);
}

export const NO_TAVILY_FOOTER =
  "\n\n---\n*Add a Tavily API key in Settings → LLM Providers for deeper, web-researched analysis.*";

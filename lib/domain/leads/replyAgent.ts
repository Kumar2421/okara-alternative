import type { LlmDriver } from "@/lib/llm";

export type ReplyClassification = "interested" | "not-interested" | "ooo" | "other";

export type DraftedFollowUp = {
  classification: ReplyClassification;
  subject: string;
  body: string;
};

/** Narrow LLM job, same shape as every other agent here: classify + draft
 * text, never decide or send anything on its own. Human always reviews the
 * draft in ComposeEmailModal before a real send happens — no autonomous
 * auto-reply loop. */
export async function classifyAndDraftFollowUp(
  driver: LlmDriver,
  apiKey: string,
  model: string,
  productName: string,
  leadName: string,
  replySnippet: string,
  baseUrl?: string
): Promise<DraftedFollowUp> {
  const system = `You classify a real inbound email reply for a sales outreach lead, then draft a short, human-sounding follow-up. Output ONLY the exact format requested.`;
  const prompt = `Product: ${productName}
Lead: ${leadName}
Their reply (real, from Gmail): "${replySnippet}"

Classify the reply as exactly one of: interested, not-interested, ooo, other.
Then draft a short follow-up email appropriate to that classification (e.g. if interested, propose a next step; if not-interested, a brief polite close; if ooo, a short "following up" note; if other, ask a clarifying question).

Return in exactly this format:
CLASSIFICATION: <interested|not-interested|ooo|other>
SUBJECT: <subject line>
BODY:
<<<
<email body>
>>>`;

  const result = await driver({ apiKey, model, system, messages: [{ role: "user", content: prompt }], baseUrl });
  const raw = result.text ?? "";

  const classMatch = raw.match(/CLASSIFICATION:\s*(interested|not-interested|ooo|other)/i);
  const subjectMatch = raw.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = raw.match(/BODY:\s*\n?<<<\n?([\s\S]*?)\n?>>>/);

  if (!subjectMatch || !bodyMatch) {
    throw new Error("Model didn't return a parseable follow-up draft — try again.");
  }

  return {
    classification: (classMatch?.[1].toLowerCase() as ReplyClassification) ?? "other",
    subject: subjectMatch[1].trim(),
    body: bodyMatch[1].trim(),
  };
}

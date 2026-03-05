import { env } from "../../env.js";
import { HttpError } from "../../utils/http.js";
import { AiIntakeResultSchema, type AiIntakeInput, type AiIntakeResult } from "./ai.validators.js";

type ChatMessage = { role: "system" | "user"; content: string };

function safeFallback(text: string): AiIntakeResult {
  const trimmed = text.trim();
  return {
    category: "General",
    urgency: "normal",
    summary: trimmed.length > 140 ? `${trimmed.slice(0, 140)}...` : trimmed || "Service request",
    tags: [],
    confidence: 0.2,
    questions: ["What service category do you need?"],
  };
}

function buildSystemPrompt(categoryNames: string[]) {
  // Keep this short; you can evolve it.
  return `
You are an assistant that converts a user problem description into structured fields for dispatching service vendors.

Return ONLY valid JSON with this exact shape:
{
  "category": string,
  "urgency": "normal" | "urgent",
  "summary": string,
  "tags": string[],
  "confidence": number, // 0..1
  "questions": string[] // 0..3 short follow-ups if unclear
}

Rules:
- category MUST be one of: ${categoryNames.map((c) => `"${c}"`).join(", ")}.
- If not sure, choose "General" and add 1-3 questions.
- urgency is "urgent" if it sounds like danger, stranded, medical-ish, fire, burglary, major leak, etc.
- summary should be short and clear for a vendor to read.
`.trim();
}

async function fetchCategoryNames(): Promise<string[]> {
  // Optional: pull from DB later. For now keep a default list.
  // If you want DB-backed categories immediately, we can import prisma here.
  return ["Mechanic", "Towing", "Electrician", "Plumber", "Generator", "AC", "Carpenter", "Cleaner", "General"];
}

async function callOpenAI(messages: ChatMessage[]): Promise<string> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpError(500, "Missing OPENAI_API_KEY");

  // If you’re not using OpenAI directly, tell me what provider and I’ll swap this client.
  const model = env.OPENAI_MODEL ?? "gpt-4o-mini";

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages,
      response_format: { type: "json_object" }, // forces JSON output
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new HttpError(502, `AI provider error: ${resp.status} ${t}`);
  }

  const json = (await resp.json()) as any;
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") throw new HttpError(502, "AI returned empty response");
  return content;
}

export async function analyzeIntake(input: AiIntakeInput): Promise<AiIntakeResult> {
  try {
    const categories = await fetchCategoryNames();

    const userTextParts = [
      `Text: ${input.text}`,
      input.city ? `City: ${input.city}` : null,
      typeof input.lat === "number" && typeof input.lng === "number" ? `Location: ${input.lat}, ${input.lng}` : null,
      input.context ? `Context: ${JSON.stringify(input.context)}` : null,
    ].filter(Boolean);

    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(categories) },
      { role: "user", content: userTextParts.join("\n") },
    ];

    const raw = await callOpenAI(messages);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return safeFallback(input.text);
    }

    const result = AiIntakeResultSchema.safeParse(parsed);
    if (!result.success) return safeFallback(input.text);

    return result.data;
  } catch {
    return safeFallback(input.text);
  }
}

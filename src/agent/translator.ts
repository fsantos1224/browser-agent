import OpenAI from "openai";
import { child } from "../logger.js";

const log = child("translator");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

const TRANSLATION_PROMPT = `You are a high-fidelity translation agent. Your sole purpose is to translate user prompts for a browser automation agent into clear, precise English.

RULES:
- Maintain the exact intent, nuance, and sequence of the original request.
- Do NOT summarize, rephrase, or "improve" the request.
- Do NOT add any commentary or explanations.
- Keep proper nouns, brand names, and specific identifiers (like "G1", "Governo do Brasil") exactly as they are.
- Output ONLY the translated text.

Example:
Input: "abra o site do g1 e me diga a primeira noticia"
Output: "open the G1 website and tell me the first news story"
`;

export async function translatePrompt(prompt: string): Promise<string> {
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: TRANSLATION_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    });

    const translation = response.choices[0].message.content || prompt;
    log.info({ original: prompt, translated: translation }, "prompt translated");
    return translation.trim();
  } catch (e: any) {
    log.error({ error: e.message }, "translation failed");
    return prompt; // Fallback to original if translation fails
  }
}

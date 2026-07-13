import { createHash } from "node:crypto";
import OpenAI from "openai";
import { child } from "../logger.js";

const log = child("normalizer");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const model = process.env.NORMALIZER_MODEL || "gpt-4o-mini";

const SYSTEM_PROMPT = `You normalize browser automation commands to a single canonical English line.

Output rules:
- Exactly ONE line. No surrounding quotes around the whole line. No markdown. No explanation.
- All verbs and structure MUST be in English.
- Translate non-English verbs and structure to the listed canonical verbs.
- Do NOT translate proper nouns, brand names, or named entities; keep them exactly as written.
- IMPORTANT: If the request contains MULTIPLE distinct steps (e.g., "Go to X, find Y, click Z, and screenshot"), do NOT try to merge them into a single complex sentence. Instead, output the first logical step only. This allows the agent loop to handle the sequence.
- If the request is a simple "Open X and search Y", output "search <query> on <site>".
- For click, wrap the target label/selector in double quotes: click "<label>"
- For type, wrap the input text in double quotes: type "<text>" into <field>"
- NEVER invent placeholders like "<link to...>" or "<element...>"; use the actual text provided in the prompt or leave it as a descriptive label.

Canonical verbs:
  go to <url-or-domain>
  navigate to <url>
  open <url>
  load <url>
  search <query> on <site>
  click "<selector-or-label>"
  extract <selector-or-role>
  type "<text>" into <selector-or-role>
  scroll up [pixels]
  scroll down [pixels]
  take screenshot

Output ONLY the normalized line.`;

const TIMEOUT = 12_000;

async function callNormalize(prompt: string, signal: AbortSignal): Promise<string> {
  const res = await client.chat.completions.create(
    {
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    },
    { signal },
  );
  return (res.choices[0].message.content || "").trim();
}

function coerce(line: string): string {
  let s = line
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');

  const openSearch = s.match(
    /^(?:go to|navigate to|open|visit|load)\s+(\S+?)\s+(?:and then|then|and)\s+search(?:\s+for)?\s+(.+?)(?:\s+on\s+\S+)?$/i,
  );
  if (openSearch) {
    return `search ${openSearch[2].trim()} on ${openSearch[1].trim()}`;
  }

  const clickQuoted = s.match(
    /^click(?:\s+on)?(?:\s+the)?(?:\s+(?:button|link))?\s+["']([^"']+)["']$/i,
  );
  if (clickQuoted) {
    return `click "${clickQuoted[1].trim()}"`;
  }

  const clickUnquoted = s.match(
    /^click(?:\s+on)?(?:\s+the)?(?:\s+(?:button|link))?\s+(.+?)$/i,
  );
  if (clickUnquoted) {
    const target = clickUnquoted[1]
      .replace(/["']/g, "")
      .replace(/\s+(?:button|link)$/i, "")
      .trim();
    return `click "${target}"`;
  }

  const typeMatch = s.match(
    /^(?:type|fill|enter)\s+["'`]([^"'`]+)["'`]\s+(?:in|into|on)\s+["']?(.+?)["']?$/i,
  );
  if (typeMatch) {
    return `type "${typeMatch[1].trim()}" into ${typeMatch[2].trim()}`;
  }

  return s;
}

export async function normalize(prompt: string): Promise<string> {
  const start = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const raw = await callNormalize(prompt, controller.signal);
      const firstLine = raw.split("\n")[0].trim();
      const out = coerce(firstLine) || prompt;
      log.info(
        {
          promptLen: prompt.length,
          normalizedLen: out.length,
          durationMs: Date.now() - start,
          attempt,
          outputHash: createHash("sha256").update(out).digest("hex").slice(0, 8),
        },
        "ok",
      );
      return out;
    } catch (e: any) {
      clearTimeout(timer);
      if (attempt === 0) {
        log.warn({ errorLen: e.message?.length ?? 0, durationMs: Date.now() - start, attempt }, "retrying");
        continue;
      }
      log.warn({ errorLen: e.message?.length ?? 0, durationMs: Date.now() - start }, "failed");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  return prompt;
}

import OpenAI from "openai";
import { child } from "../logger.js";

const log = child("planner");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

export type Plan = 
  | { kind: "direct"; steps: { tool: string; args: Record<string, string>; note: string }[] }
  | { kind: "agent"; goal: string; context: string };

const PLANNER_PROMPT = `You are a Browser Automation Planner. Your job is to interpret human requests in any language and decompose them into a structured plan.

Output a JSON object with exactly one of two shapes:

1. FOR SIMPLE, DETERMINISTIC ACTIONS:
{
  "kind": "direct",
  "steps": [
    { "tool": "navigate", "args": { "url": "..." }, "note": "Navigate to..." },
    { "tool": "click", "args": { "selector": "..." }, "note": "Click on..." }
  ]
}

2. FOR COMPLEX, MULTI-STEP, OR SEARCH-BASED REQUESTS:
{
  "kind": "agent",
  "goal": "A concise, clear objective for the AI Agent loop in English.",
  "context": "Additional constraints or details the agent should remember."
}

RULES:
- If the request involves searching, analyzing a page, or multi-step logic where the next step depends on the previous result, ALWAYS use "kind": "agent".
- Do NOT invent CSS selectors. If you use "direct", use labels for clicks/types.
- For "agent" goals, be specific. Instead of "Find news", use "Navigate to G1, find the most recent news about the Brazilian government, click the article, and take a screenshot".
- All output must be valid JSON. No markdown, no explanations.`;

export async function planRequest(prompt: string): Promise<Plan> {
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: PLANNER_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const plan = JSON.parse(response.choices[0].message.content || "{}");
    log.info({ plan }, "request planned");
    return plan as Plan;
  } catch (e: any) {
    log.error({ error: e.message }, "planning failed");
    // Fallback to agent loop for any planning failure
    return { 
      kind: "agent", 
      goal: prompt, 
      context: "Planner failed, please handle this raw prompt." 
    };
  }
}

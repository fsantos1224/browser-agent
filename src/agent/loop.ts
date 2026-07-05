import OpenAI from "openai";
import type { Page } from "playwright";
import { executeAction } from "./executor.js";
import { toolDefinitions, TOOL_DONE } from "./tools-ai.js";

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required");
  return new OpenAI({ apiKey: key });
}

const SYSTEM_PROMPT = `You are a browser agent. You control a browser using the available tools.

RULES:
- Execute the user's request step by step.
- After each action, analyze the result before deciding the next step.
- Use extract to read page content before making decisions.
- When the task is complete, call the "done" tool with a summary of what was accomplished.
- If you hit an error, try an alternative approach.
- Be concise in your reasoning.`;

export async function agentLoop(page: Page, prompt: string): Promise<{ result: string; steps: number }> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  let steps = 0;
  const maxSteps = 20;

  while (steps < maxSteps) {
    steps++;

    const model = process.env.OPENAI_MODEL || "gpt-4o";
    const response = await getClient().chat.completions.create({
      model,
      messages,
      tools: toolDefinitions,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { result: msg.content ?? "No response from assistant", steps };
    }

    let taskDone = false;
    let finalResult = "";

    for (const toolCall of msg.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);

      if (toolCall.function.name === TOOL_DONE) {
        taskDone = true;
        finalResult = args.result ?? "Task completed";
        messages.push({
          role: "tool",
          content: finalResult,
          tool_call_id: toolCall.id,
        });
        break;
      }

      const result = await executeAction(page, {
        tool: toolCall.function.name,
        args,
      });

      const content = result.success
        ? `[OK] ${result.data}`
        : `[ERROR] ${result.error}`;

      messages.push({
        role: "tool",
        content,
        tool_call_id: toolCall.id,
      });

      // Add a screenshot to give the LLM visual context
      if (result.success && toolCall.function.name !== "screenshot") {
        await takeAndAttachScreenshot(page, messages, toolCall.id);
      }
    }

    if (taskDone) {
      return { result: finalResult, steps };
    }
  }

  return { result: "Max steps reached without completion", steps };
}

async function takeAndAttachScreenshot(page: Page, messages: any[], toolCallId: string) {
  try {
    const screenshotBuffer = await page.screenshot({ type: "png" });
    const base64 = screenshotBuffer.toString("base64");
    messages.push({
      role: "user",
      content: [
        { type: "text", text: "Current page state (screenshot):" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${base64}`, detail: "low" } },
      ],
    });
  } catch {
    // Screenshot is optional
  }
}

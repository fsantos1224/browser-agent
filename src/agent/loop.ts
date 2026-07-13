import OpenAI from "openai";
import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type { Logger } from "pino";
import { executeAction } from "./executor.js";
import { toolDefinitions, TOOL_DONE } from "./tools-ai.js";
import { child } from "../logger.js";

const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY is required");
const client = new OpenAI({ apiKey: key });

const SYSTEM_PROMPT = `You are a browser agent. You control a browser using the available tools.

RULES:
- Execute the user's request step by step.
- After each action, analyze the result before deciding the next step.
- Use "getContent" to read the full page text when you need to find elements.
- If you cannot find an element or link, try using "scroll" to move down the page and then use "getContent" again, as some content only loads or becomes visible when scrolling.
- Use "extract" only when you have a specific CSS selector from the page structure.
- When the task is complete, call the "done" tool with a summary of what was accomplished.
- If you hit an error, try an alternative approach.
- Be concise in your reasoning.`;

const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_STEPS = 10;
const TIMEOUT_MS = 180_000;

export type StepEvent =
  | { type: "thinking"; step: number }
  | { type: "tool_call"; step: number; tool: string; args: Record<string, string> }
  | { type: "tool_result"; step: number; tool: string; success: boolean; resultLen: number; durationMs: number }
  | { type: "done"; result: string; steps: number }
  | { type: "timeout" };

const llmLog = child("llm");

export type AgentLoopResult = {
  result: string;
  steps: number;
  history: OpenAI.Chat.ChatCompletionMessageParam[];
};

export async function agentLoop(
  page: Page,
  prompt: string,
  parentLog?: Logger,
  onStep?: (event: StepEvent) => void,
  existingHistory?: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<AgentLoopResult> {
  const log = (parentLog || llmLog).child({ phase: "agent-loop" });

  log.info({ 
    historyLen: existingHistory?.length ?? 0, 
    prompt: prompt 
  }, "agent loop entering");

  const timeoutPromise = new Promise<AgentLoopResult>((resolve) => {
    setTimeout(() => {
      log.warn({ timeoutMs: TIMEOUT_MS }, "agent loop timeout");
      onStep?.({ type: "timeout" });
      resolve({ result: "Agent loop timed out", steps: 0, history: existingHistory || [] });
    }, TIMEOUT_MS);
  });

  return Promise.race([runAgentLoop(page, prompt, log, onStep, existingHistory), timeoutPromise]);
}

async function runAgentLoop(
  page: Page,
  prompt: string,
  log: Logger,
  onStep?: (event: StepEvent) => void,
  existingHistory?: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<AgentLoopResult> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(existingHistory || []),
    { role: "user", content: prompt },
  ];

  const controller = new AbortController();
  let steps = 0;

  while (steps < MAX_STEPS) {
    steps++;
    log.info({ step: steps, maxSteps: MAX_STEPS }, "thinking...");
    onStep?.({ type: "thinking", step: steps });

    const llmStart = Date.now();
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools: toolDefinitions,
        tool_choice: "auto",
      }, { signal: controller.signal });

      const usage = response.usage;
      llmLog.info(
        {
          model,
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens,
          durationMs: Date.now() - llmStart,
        },
        "llm call",
      );

      const msg = response.choices[0].message;
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const history = messages.filter(m => m.role !== "system");
        const result = {
          result: msg.content ?? "No response from assistant",
          steps,
          history,
        };
        onStep?.({ type: "done", result: result.result, steps });
        return result;
      }

      let taskDone = false;
      let finalResult = "";

      for (const toolCall of msg.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        const toolName = toolCall.function.name;
        log.info({ step: steps, tool: toolName, argsHash: hashArgs(args) }, "tool call");
        onStep?.({ type: "tool_call", step: steps, tool: toolName, args });

        if (toolName === TOOL_DONE) {
          taskDone = true;
          finalResult = args.result ?? "Task completed";
          log.info({ step: steps, resultLen: finalResult.length }, "task complete");
          messages.push({
            role: "tool",
            content: finalResult,
            tool_call_id: toolCall.id,
          });
          break;
        }

        const toolStart = Date.now();
        const result = await executeAction(page, {
          tool: toolName,
          args,
        });

        const durationMs = Date.now() - toolStart;
        log.info(
          {
            step: steps,
            tool: toolName,
            success: result.success,
            durationMs,
            resultLen: result.data?.length ?? 0,
          },
          result.success ? "tool ok" : "tool failed",
        );
        onStep?.({ type: "tool_result", step: steps, tool: toolName, success: result.success, resultLen: result.data?.length ?? 0, durationMs });

        const content = result.success
          ? `[OK] ${result.data}`
          : `[ERROR] ${result.error}`;

        messages.push({
          role: "tool",
          content,
          tool_call_id: toolCall.id,
        });

        // Always attach accessibility tree so LLM can see page structure
        if (toolName !== "screenshot") {
          const a11yStart = Date.now();
          await attachAccessibilityTree(page, messages, toolCall.id);
          log.debug({ step: steps, durationMs: Date.now() - a11yStart }, "a11y tree attached");
        }
      }

      if (taskDone) {
        const history = messages.filter(m => m.role !== "system");
        const result = { result: finalResult, steps, history };
        onStep?.({ type: "done", result: finalResult, steps });
        return result;
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        log.warn("LLM call aborted");
        throw e;
      }
      log.error({ error: e.message }, "LLM call failed");
      throw e;
    }
  }

  const history = messages.filter(m => m.role !== "system");
  const result = { result: "Max steps reached without completion", steps, history };
  onStep?.({ type: "done", result: result.result, steps });
  return result;
}

async function attachAccessibilityTree(
  page: Page,
  messages: any[],
  toolCallId: string,
) {
  try {
    const snapshot = await ((page as any).accessibility as any).snapshot();
    if (!snapshot) return;
    const tree = flattenAccessibility(snapshot).slice(0, 2000).join("\n");
    messages.push({
      role: "user",
      content: `Page structure:\n${tree}`,
    });
  } catch {
    // optional
  }
}

function flattenAccessibility(node: any, depth = 0): string[] {
  if (!node) return [];
  const role = node.role;
  const name = node.name?.trim();
  if (!role || role === "RootWebArea") {
    const children = node.children || [];
    return children.flatMap((c: any) => flattenAccessibility(c, depth));
  }
  const prefix = "  ".repeat(depth);
  const label = name ? ` ${name.slice(0, 120)}` : "";
  const lines = [`${prefix}[${role}]${label}`];
  if (node.children) {
    for (const child of node.children) {
      lines.push(...flattenAccessibility(child, depth + 1));
    }
  }
  return lines;
}

function hashArgs(args: Record<string, any>): string {
  const s = JSON.stringify(args, Object.keys(args).sort());
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

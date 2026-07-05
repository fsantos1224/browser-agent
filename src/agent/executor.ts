import type { Page } from "playwright";
import type { Action } from "./types.js";
import { toolHandlers, type ToolName } from "./tools.js";

export async function executeAction(page: Page, action: Action) {
  const handler = toolHandlers[action.tool as ToolName];
  if (!handler) {
    return { success: false, error: `Unknown tool: "${action.tool}"` };
  }
  return handler(page, action.args);
}

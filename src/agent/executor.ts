import type { Page } from "playwright";
import type { Action } from "./types.js";
import { toolHandlers, type ToolName } from "./tools.js";

const MAX_RETRIES = 2;

export async function executeAction(page: Page, action: Action) {
  const handler = toolHandlers[action.tool as ToolName];
  if (!handler) {
    return { success: false, error: `Unknown tool: "${action.tool}"` };
  }

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        await page.waitForTimeout(1000 * Math.pow(2, attempt - 1));
      }
      return await handler(page, action.args);
    } catch (err: any) {
      lastError = err.message?.split("\n")[0] || String(err);
      if (attempt < MAX_RETRIES) {
        // Wait before retrying
        await page.waitForTimeout(1000);
      }
    }
  }

  return { success: false, error: lastError };
}

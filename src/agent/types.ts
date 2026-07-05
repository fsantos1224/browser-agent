import type { Page } from "playwright";

export interface Action {
  tool: string;
  args: Record<string, string>;
}

export interface ActionResult {
  success: boolean;
  data?: string;
  error?: string;
}

export type ToolHandler = (page: Page, args: Record<string, string>) => Promise<ActionResult>;

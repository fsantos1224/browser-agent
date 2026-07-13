import type { Browser, BrowserContext, Page } from "playwright";
import type OpenAI from "openai";

export interface Session {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  lastActiveAt: number;
  status: "active" | "closed";
  actionCount: number;
  history: OpenAI.Chat.ChatCompletionMessageParam[];
}

export interface SessionSummary {
  id: string;
  status: Session["status"];
  createdAt: number;
  lastActiveAt: number;
  actionCount: number;
  url: string;
  title: string;
  messageCount: number;
}

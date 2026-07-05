import type { Browser, BrowserContext, Page } from "playwright";

export interface Session {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  lastActiveAt: number;
  status: "active" | "closed";
  actionCount: number;
}

export interface SessionSummary {
  id: string;
  status: Session["status"];
  createdAt: number;
  lastActiveAt: number;
  actionCount: number;
  url: string;
  title: string;
}

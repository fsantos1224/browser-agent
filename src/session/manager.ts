import { chromium } from "playwright";
import { config } from "../config.js";
import type { Session, SessionSummary } from "./types.js";

const sessions = new Map<string, Session>();

export async function createSession(): Promise<Session> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("about:blank");

  const id = crypto.randomUUID();
  const session: Session = {
    id,
    browser,
    context,
    page,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: "active",
    actionCount: 0,
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  const s = sessions.get(id);
  if (s && s.status === "active") {
    s.lastActiveAt = Date.now();
  }
  return s;
}

export async function closeSession(id: string): Promise<boolean> {
  const s = sessions.get(id);
  if (!s) return false;
  s.status = "closed";
  await s.page.close().catch(() => {});
  await s.context.close().catch(() => {});
  await s.browser.close().catch(() => {});
  sessions.delete(id);
  return true;
}

export function listSessions(): SessionSummary[] {
  return Array.from(sessions.values()).map(toSummary);
}

function toSummary(s: Session): SessionSummary {
  return {
    id: s.id,
    status: s.status,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    actionCount: s.actionCount,
    url: s.page.url(),
    title: "",
  };
}

export function startCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (s.status === "closed") {
        sessions.delete(id);
        continue;
      }
      if (now - s.lastActiveAt > config.sessionTTL) {
        closeSession(id);
      }
    }
  }, config.cleanupInterval);
}

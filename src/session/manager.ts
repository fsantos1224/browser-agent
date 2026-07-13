import { config } from "../config.js";
import { acquireBrowser, releaseBrowser } from "../browser/pool.js";
import { child } from "../logger.js";
import type { Session, SessionSummary } from "./types.js";

const log = child("session");
const sessions = new Map<string, Session>();

export async function createSession(): Promise<Session> {
  const browser = await acquireBrowser();
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
    history: [],
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
  await releaseBrowser(s.browser);
  sessions.delete(id);
  return true;
}

export async function listSessions(): Promise<SessionSummary[]> {
  return Promise.all(Array.from(sessions.values()).map(async (s) => {
    return {
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      actionCount: s.actionCount,
      url: s.page.url(),
      title: await s.page.title().catch(() => ""),
      messageCount: s.history.length,
    };
  }));
}

// Remove the toSummary function as it's now integrated into listSessions

export function startCleanup() {
  const timer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, s] of sessions) {
      if (s.status === "closed") {
        sessions.delete(id);
        cleaned++;
        continue;
      }
      if (now - s.lastActiveAt > config.sessionTTL) {
        closeSession(id).then(() => log.info({ sessionId: id }, "session expired"));
      }
    }
    if (cleaned > 0) log.info({ cleaned }, "cleanup sweep");
  }, config.cleanupInterval);
  timer.unref();
  return timer;
}

export async function closeAllSessions(): Promise<void> {
  const ids = Array.from(sessions.keys());
  await Promise.allSettled(ids.map((id) => closeSession(id)));
}

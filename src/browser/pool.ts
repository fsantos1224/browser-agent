import { chromium, type Browser } from "playwright";
import { child } from "../logger.js";

const log = child("pool");
const POOL_SIZE = 3;
const pool: Browser[] = [];
let activeCount = 0;
let warming = false;

export async function warmPool(): Promise<void> {
  if (warming) return;
  warming = true;
  log.info({ target: POOL_SIZE, current: pool.length }, "warming browser pool");
  const start = Date.now();
  const launches: Promise<Browser>[] = [];
  for (let i = pool.length; i < POOL_SIZE; i++) {
    launches.push(chromium.launch({ headless: true }));
  }
  const browsers = await Promise.all(launches);
  pool.push(...browsers);
  log.info({ size: pool.length, durationMs: Date.now() - start }, "pool ready");
}

export async function acquireBrowser(): Promise<Browser> {
  while (pool.length > 0) {
    const b = pool.pop()!;
    if (b.isConnected()) {
      activeCount++;
      return b;
    }
  }
  log.warn({ active: activeCount, pool: pool.length }, "pool empty, launching on-demand");
  activeCount++;
  return await chromium.launch({ headless: true });
}

export async function releaseBrowser(browser: Browser): Promise<void> {
  if (pool.length < POOL_SIZE && browser.isConnected()) {
    pool.push(browser);
  } else {
    await browser.close().catch(() => {});
  }
  activeCount--;
}

export async function closeAll(): Promise<void> {
  const browsers = pool.splice(0, pool.length);
  activeCount = 0;
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));
  log.info({ closed: browsers.length }, "pool closed");
}

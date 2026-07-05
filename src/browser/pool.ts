import { chromium, type Browser } from "playwright";

const POOL_SIZE = 3;
const pool: Browser[] = [];
let activeCount = 0;

export async function acquireBrowser(): Promise<Browser> {
  while (pool.length > 0) {
    const b = pool.pop()!;
    if (b.isConnected()) {
      activeCount++;
      return b;
    }
  }

  if (activeCount < POOL_SIZE) {
    activeCount++;
    return await chromium.launch({ headless: true });
  }

  await Promise.race(
    pool.map((b) => new Promise<void>((r) => {
      const check = () => {
        const idx = pool.indexOf(b);
        if (idx !== -1) {
          pool.splice(idx, 1);
          activeCount++;
          r();
        }
      };
      check();
    })),
  );
  return pool.pop()!;
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
  await Promise.all(pool.map((b) => b.close().catch(() => {})));
  pool.length = 0;
  activeCount = 0;
}

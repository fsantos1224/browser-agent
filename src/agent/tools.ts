import type { Page } from "playwright";
import type { ToolHandler } from "./types.js";

export type ToolName = "navigate" | "click" | "type" | "scroll" | "extract" | "screenshot" | "done";

export const toolHandlers: Record<ToolName, ToolHandler> = {
  async navigate(page, args) {
    const url = args.url?.startsWith("http") ? args.url : `https://${args.url}`;
    await page.goto(url, { waitUntil: "networkidle" });
    return { success: true, data: `Navigated to ${url}` };
  },

  async click(page, args) {
    await page.click(args.selector, { timeout: 5000 });
    return { success: true, data: `Clicked "${args.selector}"` };
  },

  async type(page, args) {
    await page.fill(args.selector, args.text);
    return { success: true, data: `Typed into "${args.selector}"` };
  },

  async scroll(page, args) {
    if (args.selector) {
      await page.evaluate((sel) => {
        document.querySelector(sel)?.scrollIntoView({ behavior: "smooth" });
      }, args.selector);
      return { success: true, data: `Scrolled to "${args.selector}"` };
    }
    const dir = args.direction ?? "down";
    const amount = parseInt(args.amount) || 300;
    const dx = dir === "right" ? amount : 0;
    const dy = dir === "down" ? amount : dir === "up" ? -amount : 0;
    await page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx, dy });
    return { success: true, data: `Scrolled ${dir} ${amount}px` };
  },

  async extract(page, args) {
    const selector = args.selector;
    if (!selector) return { success: false, error: "No selector provided" };
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) {
      return { success: false, error: `No element found for "${selector}"` };
    }
    const text = await el.textContent();
    return { success: true, data: text?.trim() ?? "" };
  },

  async screenshot(page, _args) {
    const path = `/tmp/browseagent-screenshot-${Date.now()}.png`;
    await page.screenshot({ path });
    return { success: true, data: path };
  },

  async done(page, _args) {
    return { success: true, data: "Task completed" };
  },
};

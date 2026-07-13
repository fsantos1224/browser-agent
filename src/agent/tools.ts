import type { Page } from "playwright";
import type { ToolHandler } from "./types.js";

export type ToolName = "navigate" | "click" | "type" | "scroll" | "extract" | "getContent" | "screenshot" | "done";

export const toolHandlers: Record<ToolName, ToolHandler> = {
  async navigate(page, args) {
    const url = args.url?.startsWith("http") ? args.url : `https://${args.url}`;
    await page.goto(url, { waitUntil: "load", timeout: 15000 });

    // Deep Scan: Force lazy-loading by scrolling to bottom and back to top
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let totalHeight = 0;
        let distance = 100;
        let timer = setInterval(() => {
          let scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
      window.scrollTo(0, 0);
    });

    return { success: true, data: `Navigated to ${url} and performed deep scan for lazy-loading content.` };
  },

  async click(page, args) {
    await page.click(args.selector, { timeout: 3000 });
    return { success: true, data: `Clicked "${args.selector}"` };
  },

  async type(page, args) {
    await page.fill(args.selector, args.text, { timeout: 3000 });
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

  async getContent(page, _args) {
    // Trigger lazy loading by scrolling slightly
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight / 2);
      await new Promise(r => setTimeout(r, 100));
      window.scrollTo(0, 0);
    });

    const text = await page.evaluate(() => {
      const el = document.body;
      if (!el) return "";
      // Remove script/style/nav/footer noise but keep the main content
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, noscript, svg, footer, header").forEach(e => e.remove());
      return clone.innerText?.trim() ?? "";
    });
    // Increase truncation limit to provide more context to the LLM
    const maxLen = 15000;
    const truncated = text.length > maxLen ? text.slice(0, maxLen) + "\n...(truncated)" : text;
    return { success: true, data: truncated };
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

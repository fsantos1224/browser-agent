import { chromium, type Page } from "playwright";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type State = {
  url: string;
  title: string;
  actionCount: number;
  lastAction: string | null;
};

function parseCommand(line: string) {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  return { cmd, args, raw: line.trim() };
}

function formatState(state: State): string {
  return [
    `  URL:    ${state.url}`,
    `  Title:  ${state.title}`,
    `  Steps:  ${state.actionCount}`,
    state.lastAction ? `  Last:   ${state.lastAction}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function execute(
  page: Page,
  cmd: string,
  args: string[],
): Promise<string> {
  switch (cmd) {
    case "go": {
      // go to <url>
      if (args[0] !== "to" || !args[1]) return "Usage: go to <url>";
      const url = args[1].startsWith("http") ? args[1] : `https://${args[1]}`;
      await page.goto(url, { waitUntil: "networkidle" });
      return `Navigated to ${url}`;
    }

    case "click": {
      if (!args.length) return "Usage: click <selector>";
      const selector = args.join(" ");
      await page.click(selector, { timeout: 5000 });
      return `Clicked "${selector}"`;
    }

    case "type": {
      if (args.length < 2) return "Usage: type <selector> <text>";
      const selector = args[0];
      const text = args.slice(1).join(" ");
      await page.fill(selector, text);
      return `Typed "${text}" into "${selector}"`;
    }

    case "scroll": {
      if (args[0] === "to" && args[1]) {
        await page.evaluate((sel) => {
          document.querySelector(sel)?.scrollIntoView({ behavior: "smooth" });
        }, args.slice(1).join(" "));
        return `Scrolled to "${args.slice(1).join(" ")}"`;
      }
      const dir = args[0] ?? "down";
      const amount = parseInt(args[1]) || 300;
      const dx = dir === "right" ? amount : 0;
      const dy = dir === "down" ? amount : dir === "up" ? -amount : 0;
      await page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx, dy });
      return `Scrolled ${dir} ${amount}px`;
    }

    case "extract": {
      if (!args.length) return "Usage: extract <selector>";
      const selector = args.join(" ");
      const el = page.locator(selector).first();
      if ((await el.count()) === 0) return `No element found for "${selector}"`;
      const text = await el.textContent();
      return text?.trim() ?? "";
    }

    case "screenshot": {
      const name = args[0] || `screenshot-${Date.now()}`;
      const path = `${name}.png`;
      await page.screenshot({ path, fullPage: false });
      return `Saved ${path}`;
    }

    case "links": {
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a")).map((a) => ({
          text: a.textContent?.trim().slice(0, 60) || "",
          href: (a as HTMLAnchorElement).href,
        })),
      );
      if (links.length === 0) return "No links found";
      return links
        .slice(0, 30)
        .map((l, i) => `  [${i + 1}] ${l.text} → ${l.href}`)
        .join("\n");
    }

    default:
      return `Unknown command: "${cmd}". Type "help" for available commands.`;
  }
}

function showHelp() {
  return [
    "Commands:",
    "  go to <url>         — Navigate to URL",
    "  click <selector>    — Click element",
    "  type <sel> <text>   — Type into input",
    "  scroll <dir> [px]   — Scroll (up/down/left/right)",
    "  scroll to <sel>     — Scroll element into view",
    "  extract <selector>  — Get text from element",
    "  screenshot [name]   — Save screenshot",
    "  links               — List page links",
    "  state               — Show current state",
    "  help                — This menu",
    "  exit                — Quit",
  ].join("\n");
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto("about:blank");

  const rl = readline.createInterface({ input, output, terminal: false });
  const state: State = { url: "", title: "", actionCount: 0, lastAction: null };

  console.log("\n🧠 BrowseAgent v0 — Terminal Prototype");
  console.log("Type 'help' for commands, 'exit' to quit.\n");

  rl.setPrompt("> ");
  rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); continue; }

    const { cmd, args, raw } = parseCommand(trimmed);

    if (cmd === "exit") break;
    if (cmd === "help") {
      console.log(showHelp());
      rl.prompt();
      continue;
    }
    if (cmd === "state") {
      console.log(formatState(state));
      rl.prompt();
      continue;
    }

    try {
      const result = await execute(page, cmd, args);
      state.url = page.url();
      state.title = await page.title();
      state.actionCount++;
      state.lastAction = raw;

      console.log(`  ✓ ${result}`);
      console.log();
      console.log(formatState(state));
    } catch (err: any) {
      console.log(`  ✗ Error: ${err.message?.split("\n")[0] || err}`);
    }
    console.log();
    try { rl.prompt(); } catch {} 
  }

  await browser.close().catch(() => {});
  rl.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

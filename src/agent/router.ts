import type { Page } from "playwright";
import { executeAction } from "./executor.js";
import { child } from "../logger.js";

const log = child("router");

export type DirectStep = {
  tool: string;
  args: Record<string, string>;
  note?: string;
};

export type Route =
  | { kind: "direct"; reason: string; steps: DirectStep[] }
  | { kind: "agent"; reason: string };

const URL_RE = /^(?:https?:\/\/)?(?:[\w-]+\.)+[\w-]+(?:\/\S*)?$/i;

export function classify(prompt: string, currentUrl?: string): Route {
  const original = prompt;
  const p = prompt.trim().replace(/\s+/g, " ");
  const lower = p.toLowerCase();

  if (looksLikeBareUrl(p)) {
    return {
      kind: "direct",
      reason: "bare URL",
      steps: [{ tool: "navigate", args: { url: toUrl(p) } }],
    };
  }

  const nav = matchNavigate(lower, p);
  if (nav) {
    let target = stripArticles(nav.target);
    target = stripQualifierNouns(target);
    target = stripArticles(target);
    target = target.replace(/^["'`]+|["'`]+$/g, "").replace(/[.,;!?]+$/, "");
    if (looksLikeUrl(target) || looksLikeDomain(target)) {
      return {
        kind: "direct",
        reason: "navigate",
        steps: [{ tool: "navigate", args: { url: toUrl(target) } }],
      };
    }
    if (currentUrl) {
      try {
        const base = new URL(currentUrl);
        const resolved = new URL(target, base).toString();
        return {
          kind: "direct",
          reason: "navigate-relative",
          steps: [{ tool: "navigate", args: { url: resolved } }],
        };
      } catch {}
    }
  }

  if (matchScreenshot(lower)) {
    return {
      kind: "direct",
      reason: "screenshot",
      steps: [{ tool: "screenshot", args: {} }],
    };
  }

  const scroll = matchScroll(lower);
  if (scroll) {
    return {
      kind: "direct",
      reason: "scroll",
      steps: [{
        tool: "scroll",
        args: { direction: scroll.direction, amount: String(scroll.amount) },
      }],
    };
  }

  const extract = matchExtract(lower, p);
  if (extract) {
    if (looksLikeCssSelector(extract.selector)) {
      return {
        kind: "direct",
        reason: "extract",
        steps: [{ tool: "extract", args: { selector: extract.selector } }],
      };
    }
    const auto = autoSelector(extract.selector);
    if (auto) {
      return {
        kind: "direct",
        reason: "extract",
        steps: [{ tool: "extract", args: { selector: auto } }],
      };
    }
  }

  const click = matchClick(lower, p);
  if (click) {
    const sel = resolveSelector(click.target, "click");
    if (sel) {
      return {
        kind: "direct",
        reason: "click",
        steps: [{ tool: "click", args: { selector: sel } }],
      };
    }
  }

  const type = matchType(lower, p);
  if (type) {
    const sel = resolveSelector(type.field, "type");
    if (sel) {
      return {
        kind: "direct",
        reason: "type",
        steps: [{ tool: "type", args: { selector: sel, text: type.text } }],
      };
    }
  }

  const search = matchSearch(lower, p);
  if (search) {
    return {
      kind: "direct",
      reason: "search",
      steps: buildSearchSteps(search),
    };
  }

  log.info({ promptLen: original.length }, "→ agent loop");
  return { kind: "agent", reason: "no deterministic match, falling back to AI" };
}

const NAV_VERBS = [
  "navigate to", "go to", "browse to", "open", "visit", "load",
].sort((a, b) => b.length - a.length);

function matchNavigate(lower: string, raw: string): { target: string } | null {
  for (const verb of NAV_VERBS) {
    if (lower.startsWith(verb + " ")) {
      const rest = raw.slice(verb.length).trim();
      if (rest) return { target: rest };
    }
  }
  return null;
}

function stripArticles(s: string): string {
  return s.replace(/^(?:the)\s+/i, "");
}

function stripQualifierNouns(s: string): string {
  return s.replace(/^(?:site|website|page|portal|link|url)\s+/i, "");
}

function matchScreenshot(lower: string): boolean {
  return /^(?:take|capture|grab|save|screenshot)(?:\s+(?:a|an|the))?\s+(?:screenshot|capture|picture|print|page|snapshot)(?:\s+of\s+(?:the\s+)?page)?\s*[.!?]?$/.test(lower);
}

function matchScroll(lower: string): { direction: "up" | "down"; amount: number } | null {
  const m = lower.match(/^scroll\s+(?:to\s+(?:the\s+)?(?:top|bottom|end|start))?\s*(up|down)?\s*(\d+)?\s*(?:px|pixels?)?\s*[.!?]?$/);
  if (!m) return null;
  const dir = (m[1] || "down").toLowerCase() === "up" ? "up" : "down";
  const amount = parseInt(m[2] || "300", 10);
  return { direction: dir, amount };
}

function matchExtract(lower: string, raw: string): { selector: string } | null {
  let m = lower.match(/^(?:extract|get|read|fetch|capture|return)\s+(?:the\s+)?(?:text|content|html|innerhtml)\s+of\s+["'`]?(.+?)["'`]?\s*[.!?]?$/);
  if (m) return { selector: m[1].trim() };
  m = lower.match(/^(?:extract|get|read|fetch|capture|return)\s+(?:the\s+)?(?:text|content|html|innerhtml\s+of)?\s*["'`]?(.+?)["'`]?\s*[.!?]?$/);
  if (m) return { selector: m[1].trim() };
  return null;
}

function matchClick(lower: string, raw: string): { target: string } | null {
  let m = lower.match(/^(?:click|press|tap)(?:\s+(?:on))?\s+(?:button|link)\s+["'“”](.+?)["'“”]\s*[.!?]?$/);
  if (m) return { target: m[1].trim() };
  m = lower.match(/^(?:click|press|tap)(?:\s+(?:on))?\s+["'“”]?(.+?)["'“”]?\s*[.!?]?$/);
  if (!m) return null;
  return { target: m[1].trim() };
}

function matchType(lower: string, raw: string): { field: string; text: string } | null {
  let m = raw.match(/^(?:type|fill|enter|input)\s+["'`](.+?)["'`]\s+(?:in|into|on)\s+["'`]?(.+?)["'`]?\s*[.!?]?$/i);
  if (m) return { field: m[2].trim(), text: m[1].trim() };
  m = raw.match(/^(?:type|fill|enter|input)\s+["'“”](.+?)["'“”]\s+(.+?)\s*[.!?]?$/i);
  if (m && looksLikeCssSelector(m[2])) return { field: m[2].trim(), text: m[1].trim() };
  return null;
}

function matchSearch(lower: string, raw: string): { query: string; site?: string } | null {
  // If the prompt contains sequential markers like "then" or "and then", 
  // it's a multi-step request and should be handled by the AI agent, not the direct router.
  if (/\b(then|and then|after that|subsequently)\b/i.test(lower)) {
    return null;
  }

  let m = raw.match(/^(?:search(?:\s+for)?|find)\s+["'“”]?(.+?)["'“”]?\s+(?:on|in)\s+["'“”]?([^\s"'“”]+(?:\.[^\s"'“”]+)+)["'“”]?\s*[.!?]?$/i);
  if (m) return { query: m[1].trim(), site: m[2].trim() };

  m = raw.match(/^(?:search(?:\s+for)?|find)\s+["'“”]?(.+?)["'“”]?\s+(?:on|in)\s+(.+?)\s*[.!?]?$/i);
  if (m && looksLikeDomain(m[2])) {
    return { query: m[1].trim(), site: m[2].trim() };
  }

  return null;
}

function buildSearchSteps(s: { query: string; site?: string }): DirectStep[] {
  if (s.site) {
    return [{
      tool: "navigate",
      args: { url: buildSearchUrl(s.site, s.query) },
      note: `search "${s.query}" on ${s.site}`,
    }];
  }
  return [{
    tool: "navigate",
    args: { url: `https://www.google.com/search?q=${encodeURIComponent(s.query)}` },
    note: `google search "${s.query}"`,
  }];
}

const SEARCH_PATHS = [
  "/search?q={q}",
  "/search?query={q}",
  "/?s={q}",
  "/?q={q}",
];

function buildSearchUrl(site: string, query: string): string {
  const cleaned = site.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  const q = encodeURIComponent(query);
  const path = SEARCH_PATHS[Math.floor(Math.random() * SEARCH_PATHS.length)];
  const isLocal = /^(localhost|127\.|192\.|10\.|::1)/i.test(cleaned);
  const proto = isLocal ? "http" : "https";
  return `${proto}://${cleaned}${path.replace("{q}", q)}`;
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || URL_RE.test(s);
}

function looksLikeBareUrl(s: string): boolean {
  return /^(?:https?:\/\/)?(?:[\w-]+\.)+[\w-]+(?:\/\S*)?$/i.test(s.trim());
}

function looksLikeDomain(s: string): boolean {
  return /^(?:[\w-]+\.)+[\w-]+$/i.test(s.trim());
}

function toUrl(s: string): string {
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s.replace(/^\/+/, "")}`;
}

function shorten(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function looksLikeCssSelector(s: string): boolean {
  return /^[#.\[]\S+/.test(s) ||
    /^[\w-]+\[[^\]]+\]/.test(s) ||
    /^[\w-]+\s*[>+~]\s*\S+/.test(s) ||
    /^(html|body|main|header|footer|nav|section|article|aside|form|button|input|textarea|select|a|h[1-6]|p|ul|ol|li|table|tr|td|th|img|div|span)$/i.test(s);
}

function autoSelector(role: string): string | undefined {
  const r = role.toLowerCase().trim();
  const map: Record<string, string> = {
    "title": "title",
    "h1": "h1",
    "h2": "h2",
    "h3": "h3",
    "headings": "h1, h2, h3",
    "paragraphs": "p",
    "links": "a",
    "images": "img",
    "buttons": "button",
    "inputs": "input",
    "forms": "form",
    "list items": "li",
    "tables": "table",
    "header": "header",
    "footer": "footer",
    "nav": "nav",
    "main": "main",
    "article": "article",
    "search": "[type='search'], [name='q'], [name='search'], input[placeholder*='search' i]",
    "login": "button[type='submit'], input[type='submit'], button:has-text('login'), button:has-text('sign in')",
  };
  return map[r];
}

const SELECTOR_HINTS: { test: RegExp; selector: (m: RegExpMatchArray) => string; kind?: "click" | "type" | "any" }[] = [
  { test: /^["'“”](.+?)["'“”]$/, selector: (m) => `:is(a,button):has-text("${m[1]}")`, kind: "click" },
  { test: /^button(?:\s+labeled?)?\s+["'“”](.+?)["'“”]$/i, selector: (m) => `button:has-text("${m[1]}")`, kind: "click" },
  { test: /^link(?:\s+labeled?)?\s+["'“”](.+?)["'“”]$/i, selector: (m) => `a:has-text("${m[1]}")`, kind: "click" },
  { test: /^(?:the\s+)?search\s+(?:bar|box|field|input|button)/i, selector: () => `[type='search'], [name='q'], [name='search'], input[placeholder*='search' i]`, kind: "any" },
  { test: /^(?:the\s+)?login\s+(?:button|link)/i, selector: () => `button:has-text('login'), button:has-text('sign in'), a:has-text('login'), a:has-text('sign in')`, kind: "any" },
  { test: /^(?:the\s+)?menu\s+(?:button|hamburger)/i, selector: () => `button[aria-label*='menu' i], [class*='hamburger' i], [class*='menu-toggle' i]`, kind: "any" },
  { test: /^(?:the\s+)?(.*?)\s+field$/i, selector: (m) => `[name="${m[1]}"], input[placeholder*="${m[1]}" i], #${m[1]}`, kind: "type" },
  { test: /^(.*?)\s+input$/i, selector: (m) => `[name="${m[1]}"], input[placeholder*="${m[1]}" i]`, kind: "type" },
];

function resolveSelector(target: string, kind: "click" | "type" = "click"): string | null {
  const t = target.trim();
  if (looksLikeCssSelector(t)) return t;

  for (const hint of SELECTOR_HINTS) {
    if (hint.kind === "click" && kind !== "click") continue;
    if (hint.kind === "type" && kind !== "type") continue;
    const m = t.match(hint.test);
    if (m) return hint.selector(m);
  }

  if (kind === "click") {
    return `:is(a,button):has-text("${t}")`;
  }

  return `[name="${t}"], input[placeholder*="${t}" i], #${t}`;
}

export async function executeDirectSteps(page: Page, steps: DirectStep[]): Promise<{ steps: number; result: string }> {
  let lastResult = "";
  let count = 0;
  for (const step of steps) {
    const stepLog = log.child({ tool: step.tool });
    stepLog.info({ argsKeys: Object.keys(step.args) }, "executing direct step");
    const result = await executeAction(page, step);
    count++;
    if (result.success) {
      lastResult = result.data || "ok";
      stepLog.info({ resultLen: lastResult.length }, "ok");
    } else {
      stepLog.error({ errorLen: result.error?.length ?? 0 }, "direct step failed");
      throw new Error(result.error || "step failed");
    }
  }
  return { steps: count, result: lastResult || "done" };
}

const selectorCache = new Map<string, string>();

export function rememberSelector(url: string, description: string, selector: string) {
  try {
    const u = new URL(url);
    const key = `${u.host}::${description.toLowerCase().trim()}`;
    selectorCache.set(key, selector);
  } catch {}
}

export function recallSelector(url: string, description: string): string | undefined {
  try {
    const u = new URL(url);
    const key = `${u.host}::${description.toLowerCase().trim()}`;
    return selectorCache.get(key);
  } catch {
    return undefined;
  }
}

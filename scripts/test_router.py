#!/usr/bin/env python3
"""
Router tests — verify all deterministic patterns resolve WITHOUT AI calls.

Each case asserts a specific route.kind and step shape. Exit code != 0 on any failure.

Usage:
  python3 scripts/test_router.py
  python3 scripts/test_router.py -v   # verbose: print all cases
"""

import json
import subprocess
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).parent / "_router_runner.ts"
SCRIPT = r"""
import { classify } from "../src/agent/router.js";
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const cases = JSON.parse(input);
  const out = cases.map((c) => {
    const r = classify(c.prompt, c.currentUrl);
    return { ...c, got: r };
  });
  console.log(JSON.stringify(out));
});
"""

ROOT = Path(__file__).parent

CASES = [
    # ─── bare URL ────────────────────────────────────────────────
    {"name": "bare url",                   "prompt": "example.com",                          "expectKind": "direct", "expectTool": "navigate"},
    {"name": "bare url with path",         "prompt": "https://news.ycombinator.com",          "expectKind": "direct", "expectTool": "navigate"},
    {"name": "bare url with slash path",   "prompt": "github.com/anomalyco/opencode",         "expectKind": "direct", "expectTool": "navigate"},

    # ─── navigate directive ─────────────────────────────────────
    {"name": "go to",                      "prompt": "go to example.com",                    "expectKind": "direct", "expectTool": "navigate"},
    {"name": "navigate to",                "prompt": "navigate to https://wikipedia.org",     "expectKind": "direct", "expectTool": "navigate"},
    {"name": "open site",                  "prompt": "open example.com",                    "expectKind": "direct", "expectTool": "navigate"},
    {"name": "visit",                      "prompt": "visit github.com",                     "expectKind": "direct", "expectTool": "navigate"},
    {"name": "load",                       "prompt": "load news.ycombinator.com",            "expectKind": "direct", "expectTool": "navigate"},
    {"name": "browse to",                  "prompt": "browse to wikipedia.org",              "expectKind": "direct", "expectTool": "navigate"},
    {"name": "navigate with article",      "prompt": "open the site example.com",           "expectKind": "direct", "expectTool": "navigate"},
    {"name": "navigate quoted url",        "prompt": 'go to "example.com"',                 "expectKind": "direct", "expectTool": "navigate"},

    # ─── search directive ────────────────────────────────────────
    {"name": "search on site",             "prompt": "search alpha on example.com",          "expectKind": "direct", "expectTool": "navigate", "expectUrlHas": "example.com"},
    {"name": "find on site",               "prompt": "find beta on example.com",             "expectKind": "direct", "expectTool": "navigate", "expectUrlHas": "example.com"},
    {"name": "search for on site",         "prompt": "search for gamma on example.com",      "expectKind": "direct", "expectTool": "navigate", "expectUrlHas": "example.com"},

    # ─── screenshot ──────────────────────────────────────────────
    {"name": "screenshot",                 "prompt": "take a screenshot",                    "expectKind": "direct", "expectTool": "screenshot"},
    {"name": "capture page",               "prompt": "capture page",                         "expectKind": "direct", "expectTool": "screenshot"},
    {"name": "save screenshot",            "prompt": "save screenshot",                      "expectKind": "direct", "expectTool": "screenshot"},

    # ─── scroll ──────────────────────────────────────────────────
    {"name": "scroll down",                "prompt": "scroll down 500",                      "expectKind": "direct", "expectTool": "scroll", "expectArgs": {"direction": "down"}},
    {"name": "scroll up",                  "prompt": "scroll up",                            "expectKind": "direct", "expectTool": "scroll", "expectArgs": {"direction": "up"}},
    {"name": "scroll to top",              "prompt": "scroll to top",                        "expectKind": "direct", "expectTool": "scroll"},
    {"name": "scroll to bottom",           "prompt": "scroll to bottom 1000",                "expectKind": "direct", "expectTool": "scroll"},

    # ─── extract ─────────────────────────────────────────────────
    {"name": "extract h1",                 "prompt": "extract h1",                           "expectKind": "direct", "expectTool": "extract"},
    {"name": "extract title",              "prompt": "get the title",                        "expectKind": "direct", "expectTool": "extract"},
    {"name": "extract by selector",        "prompt": "extract .article-body",                "expectKind": "direct", "expectTool": "extract"},
    {"name": "extract by id",              "prompt": "extract #main-content",                "expectKind": "direct", "expectTool": "extract"},
    {"name": "read text of h2",            "prompt": "read text of h2",                      "expectKind": "direct", "expectTool": "extract"},
    {"name": "get headings",               "prompt": "get headings",                         "expectKind": "direct", "expectTool": "extract"},
    {"name": "fetch paragraphs",           "prompt": "fetch paragraphs",                     "expectKind": "direct", "expectTool": "extract"},

    # ─── click ───────────────────────────────────────────────────
    {"name": "click by selector",          "prompt": "click #submit-btn",                    "expectKind": "direct", "expectTool": "click"},
    {"name": "click by class",             "prompt": "click .login-button",                  "expectKind": "direct", "expectTool": "click"},
    {"name": "click button label",         "prompt": 'click button "Sign in"',              "expectKind": "direct", "expectTool": "click"},
    {"name": "click link label",           "prompt": 'click link "Home"',                   "expectKind": "direct", "expectTool": "click"},
    {"name": "click search bar",           "prompt": "click the search bar",                 "expectKind": "direct", "expectTool": "click"},
    {"name": "click login button",         "prompt": "click the login button",               "expectKind": "direct", "expectTool": "click"},

    # ─── type ────────────────────────────────────────────────────
    {"name": "type into selector",         "prompt": 'type "hello" into #name',             "expectKind": "direct", "expectTool": "type"},
    {"name": "fill input",                 "prompt": 'fill "test" into input[name=email]',  "expectKind": "direct", "expectTool": "type"},
    {"name": "enter text",                 "prompt": 'enter "value" into .search-box',       "expectKind": "direct", "expectTool": "type"},

    # ─── must fall through to AI ─────────────────────────────────
    {"name": "complex multi-step",         "prompt": "visit example.com, search for alpha and open the most recent article", "expectKind": "agent"},
    {"name": "form fill with data",        "prompt": "fill out the registration form with random data", "expectKind": "agent"},
    {"name": "abstract reasoning",         "prompt": "find the cheapest flight from NYC to LA next week", "expectKind": "agent"},
]


def run_tests():
    SCRIPT_PATH.write_text(SCRIPT)
    payload = [{"prompt": c["prompt"], "currentUrl": c.get("currentUrl")} for c in CASES]
    proc = subprocess.run(
        ["npx", "tsx", str(SCRIPT_PATH)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=ROOT,
        env={**__import__("os").environ, "LOG_LEVEL": "silent"},
    )
    SCRIPT_PATH.unlink(missing_ok=True)
    if proc.returncode != 0:
        print("tsx failed:", proc.stderr, file=sys.stderr)
        print("stdout:", proc.stdout, file=sys.stderr)
        sys.exit(2)
    lines = proc.stdout.strip().splitlines()
    if not lines:
        print("empty stdout, stderr:", proc.stderr, file=sys.stderr)
        sys.exit(2)
    try:
        results = json.loads(lines[-1])
    except json.JSONDecodeError as e:
        print(f"JSON parse failed on: {lines[-1][:200]!r}", file=sys.stderr)
        print(f"stderr: {proc.stderr}", file=sys.stderr)
        sys.exit(2)

    failed = []
    for case, res in zip(CASES, results):
        got = res["got"]
        kind = got.get("kind")
        steps = got.get("steps", [])
        tool = steps[0]["tool"] if steps else None
        args = steps[0]["args"] if steps else {}

        ok = True
        reason = []

        if case.get("expectKind") and kind != case["expectKind"]:
            ok = False
            reason.append(f"kind={kind} (want {case['expectKind']})")
        if case.get("expectTool") and tool != case["expectTool"]:
            ok = False
            reason.append(f"tool={tool} (want {case['expectTool']})")
        if "expectArgs" in case:
            for k, v in case["expectArgs"].items():
                if args.get(k) != v:
                    ok = False
                    reason.append(f"args[{k}]={args.get(k)} (want {v})")
        if "expectUrlHas" in case:
            url = args.get("url", "")
            if case["expectUrlHas"] not in url:
                ok = False
                reason.append(f"url missing '{case['expectUrlHas']}' (got {url})")

        status = "✓" if ok else "✗"
        line = f"  {status} {case['name']:35s} kind={kind:6s} tool={(tool or '-'):10s}"
        if reason:
            line += f"  {' | '.join(reason)}"
        print(line)
        if not ok:
            failed.append(case["name"])

    print()
    print(f"  {len(CASES) - len(failed)}/{len(CASES)} passed")
    if failed:
        print(f"  FAILED: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    run_tests()

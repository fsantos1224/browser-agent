#!/usr/bin/env python3
"""
Normalizer end-to-end tests.

Sends non-EN prompts to a running server and verifies:
  - non-EN prompts get normalized to canonical EN
  - the route becomes "direct" when the canonical form matches a router pattern
  - EN prompts skip the normalizer (no extra latency)
  - response time stays well under the 120s client timeout

Assumes the server is running on http://localhost:3456 with OPENAI_API_KEY set.

Usage:
  python3 scripts/test_normalizer.py
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE = "http://localhost:3456"


def _request(method: str, path: str, body: dict | None = None, timeout: int = 30) -> tuple[int, dict]:
    if body is not None:
        data = json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
    else:
        data = b""
        headers = {}
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def server_alive() -> bool:
    try:
        code, _ = _request("GET", "/sessions")
        return code == 200
    except Exception:
        return False


def create_session() -> str:
    code, body = _request("POST", "/sessions", {"_": "init"})
    if code != 201:
        raise RuntimeError(f"create_session failed: {code} {body}")
    return body["sessionId"]


def delete_session(sid: str):
    _request("DELETE", f"/sessions/{sid}")


def interact(sid: str, tool: str, args: dict):
    code, body = _request("POST", f"/sessions/{sid}/interact", {"action": {"tool": tool, "args": args}})
    assert code == 200, body


def post_agent(sid: str, prompt: str, timeout: int = 130) -> tuple[int, dict, float]:
    t0 = time.time()
    try:
        code, body = _request("POST", f"/sessions/{sid}/agent", {"prompt": prompt}, timeout=timeout)
        return code, body, time.time() - t0
    except Exception as e:
        return 0, {"error": str(e)}, time.time() - t0


def start_server():
    proc = subprocess.Popen(
        ["npx", "tsx", "src/index.ts"],
        cwd=Path(__file__).parent.parent,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={**os.environ, "LOG_LEVEL": "info"},
    )
    for _ in range(40):
        if server_alive():
            return proc
        time.sleep(0.5)
    proc.terminate()
    raise RuntimeError("server failed to start")


# ─── Test cases ─────────────────────────────────────────────────
# Layout:
#   { name, prompt, expectRoute, expectTool, expectUrlHas?, maxSeconds }

# navigate / open — work on about:blank, no page prep needed
NAV_CASES = [
    {
        "name": "non-EN navigate site",
        "prompt": "Besuchen Sie die Seite example.com",
        "expectRoute": "direct",
        "expectTool": "navigate",
        "expectUrlHas": "example.com",
        "maxSeconds": 30,
    },
    {
        "name": "non-EN open domain",
        "prompt": "ouvrir example.com",
        "expectRoute": "direct",
        "expectTool": "navigate",
        "expectUrlHas": "example.com",
        "maxSeconds": 30,
    },
    {
        "name": "non-EN search on site (proper noun preserved)",
        "prompt": "buscar alpha en example.com",
        "expectRoute": "direct",
        "expectTool": "navigate",
        "expectUrlHas": "alpha",
        "maxSeconds": 30,
    },
]

# click / type — need a real page first; tests below prepare it
CLICK_TYPE_PAGE = "https://www.w3.org/TR/WD-html40-970917/interact/forms.html"
# For click/type we accept either:
#   - direct (selector matched)
#   - agent (selector didn't match, but agent fallback resolved fast)
# What we explicitly forbid is: timeout > maxSeconds OR direct-route that didn't even attempt.
CLICK_TYPE_CASES = [
    {
        "name": "non-EN click labeled button",
        "prompt": "clicca sul pulsante Submit",
        "expectRoute": "direct",
        "expectTool": "click",
        "maxSeconds": 45,
    },
    {
        "name": "non-EN type into field",
        "prompt": "rellenar campo nombre con Marcos",
        "expectRoute": "any",
        "expectTool": "type-or-agent",
        "maxSeconds": 80,
    },
]

EN_ALREADY_DIRECT = [
    {
        "name": "EN already direct (no normalizer cost)",
        "prompt": "go to example.com",
        "expectRoute": "direct",
        "expectTool": "navigate",
        "expectUrlHas": "example.com",
        "maxSeconds": 10,
    },
    {
        "name": "multi-step non-EN (joined with then)",
        "prompt": "ouvre example.com et cherche alpha",
        "expectRoute": "direct",
        "expectTool": "navigate",
        "expectUrlHas": "alpha",
        "maxSeconds": 30,
    },
]


def run(sid: str, cases: list, setup=None):
    failed = []
    for case in cases:
        if setup:
            setup(sid)
        code, body, elapsed = post_agent(sid, case["prompt"], timeout=140)
        route = body.get("route", "?" if code != 200 else "?")
        steps_count = body.get("steps")
        result_text = body.get("result", "")

        tool = None
        url = ""
        if "Navigated to " in result_text:
            tool = "navigate"
            url = result_text.split("Navigated to ", 1)[1].strip()
        elif result_text.startswith("Clicked "):
            tool = "click"
        elif result_text.startswith("Typed "):
            tool = "type"
        elif result_text.startswith("Scrolled "):
            tool = "scroll"

        ok = True
        reasons = []
        if code != 200:
            ok = False
            reasons.append(f"http={code}")
        expected_route = case.get("expectRoute")
        if expected_route and expected_route != "any" and route != expected_route:
            ok = False
            reasons.append(f"route={route} (want {expected_route})")
        expected_tool = case.get("expectTool")
        if expected_tool and expected_tool not in ["any", "type-or-agent"]:
            if tool != expected_tool:
                ok = False
                reasons.append(f"tool={tool} (want {expected_tool})")
        if "expectUrlHas" in case and case["expectUrlHas"] not in url:
            ok = False
            reasons.append(f"url missing '{case['expectUrlHas']}' (got {url[:60]})")
        if elapsed > case.get("maxSeconds", 60):
            ok = False
            reasons.append(f"too slow: {elapsed:.1f}s > {case['maxSeconds']}s")

        status = "✓" if ok else "✗"
        print(f"  {status} {case['name']:45s} route={route:6s} tool={(tool or '-'):10s} {elapsed:5.1f}s  {' | '.join(reasons) if reasons else ''}")
        if not ok:
            failed.append(case["name"])
    return failed


def setup_click_page(sid: str):
    code, body = _request("POST", f"/sessions/{sid}/interact", {"action": {"tool": "navigate", "args": {"url": CLICK_TYPE_PAGE}}}, timeout=30)
    if code != 200 or not body.get("success"):
        print(f"  ! setup navigate failed: {body}")


def main():
    proc = None
    if not server_alive():
        print("→ starting server…")
        proc = start_server()
    else:
        print("→ using already-running server on :3456")

    sid = None
    all_failed = []
    try:
        sid = create_session()
        print(f"→ session: {sid}\n")

        print("── navigate / search (about:blank OK) ──")
        all_failed += run(sid, NAV_CASES)
        print()

        print(f"── click / type (after navigate to {CLICK_TYPE_PAGE}) ──")
        all_failed += run(sid, CLICK_TYPE_CASES, setup=setup_click_page)
        print()

        print("── misc ──")
        all_failed += run(sid, EN_ALREADY_DIRECT)
        print()

        print(f"  {sum(len(cases) for cases in [NAV_CASES, CLICK_TYPE_CASES, EN_ALREADY_DIRECT]) - len(all_failed)}/{sum(len(cases) for cases in [NAV_CASES, CLICK_TYPE_CASES, EN_ALREADY_DIRECT])} passed")
        if all_failed:
            print(f"  FAILED: {all_failed}")
            sys.exit(1)
    finally:
        if sid:
            delete_session(sid)
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()


if __name__ == "__main__":
    main()

import "dotenv/config";
import Fastify from "fastify";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { createSession, getSession, closeSession, listSessions, startCleanup, closeAllSessions } from "./session/manager.js";
import { executeAction } from "./agent/executor.js";
import { agentLoop } from "./agent/loop.js";
import { translatePrompt } from "./agent/translator.js";
import { planRequest, type Plan } from "./agent/planner.js";
import { executeDirectSteps } from "./agent/router.js";
import { warmPool, closeAll } from "./browser/pool.js";
import { logger, child } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = child("http");

const app = Fastify({
  loggerInstance: logger,
  genReqId: (req) => req.headers["x-request-id"]?.toString() || crypto.randomUUID(),
  disableRequestLogging: true,
});

app.addHook("onRequest", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  (req as any).startTime = Date.now();
});

app.addHook("onResponse", async (req, reply) => {
  const duration = Date.now() - ((req as any).startTime || Date.now());
  log.info(
    {
      reqId: req.id,
      method: req.method,
      url: req.url,
      status: reply.statusCode,
      durationMs: duration,
    },
    `${req.method} ${req.url} → ${reply.statusCode}`,
  );
});

startCleanup();

app.post("/sessions", async (_req, reply) => {
  const session = await createSession();
  log.info({ reqId: _req.id, sessionId: session.id }, "session created");
  reply.code(201).send({
    sessionId: session.id,
    status: session.status,
    createdAt: session.createdAt,
  });
});

app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
  const session = getSession(req.params.id);
  if (!session) return reply.code(404).send({ error: "Session not found" });
  reply.send({
    id: session.id,
    status: session.status,
    url: session.page.url(),
    title: await session.page.title(),
    actionCount: session.actionCount,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
  });
});

app.delete<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
  const ok = await closeSession(req.params.id);
  if (!ok) return reply.code(404).send({ error: "Session not found" });
  log.info({ reqId: req.id, sessionId: req.params.id }, "session closed");
  reply.send({ status: "closed" });
});

app.delete<{ Params: { id: string } }>("/sessions/:id/history", async (req, reply) => {
  const session = getSession(req.params.id);
  if (!session) return reply.code(404).send({ error: "Session not found" });
  session.history = [];
  session.actionCount = 0;
  log.info({ reqId: req.id, sessionId: req.params.id }, "history cleared");
  reply.send({ status: "cleared" });
});

app.get("/sessions", async (_req, reply) => {
  reply.send(await listSessions());
});

app.post<{ Params: { id: string }; Body: { action: { tool: string; args?: Record<string, string> } } }>(
  "/sessions/:id/interact",
  async (req, reply) => {
    const session = getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });

    const { tool, args = {} } = req.body.action;
    const toolLog = child("tool").child({ reqId: req.id, sessionId: session.id, tool });
    toolLog.info({ argsKeys: Object.keys(args), argsLen: JSON.stringify(args).length }, "executing");

    const start = Date.now();
    const result = await executeAction(session.page, { tool, args });

    session.actionCount++;
    session.lastActiveAt = Date.now();

    toolLog.info(
      {
        success: result.success,
        durationMs: Date.now() - start,
        resultLen: result.data?.length ?? 0,
      },
      result.success ? "ok" : "failed",
    );

    reply.send({
      success: result.success,
      data: result.data,
      error: result.error,
      state: {
        url: session.page.url(),
        title: await session.page.title(),
        actionCount: session.actionCount,
      },
    });
  },
);

app.post<{ Params: { id: string }; Body: { prompt: string } }>(
  "/sessions/:id/agent",
  async (req, reply) => {
    const session = getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });

    const { prompt } = req.body;
    if (!prompt) return reply.code(400).send({ error: "prompt is required" });

    const agentLog = child("agent").child({ reqId: req.id, sessionId: session.id });

    let effective = prompt;
    const preRoute = classify(prompt, session.page.url());
    if (preRoute.kind === "agent" && process.env.OPENAI_API_KEY) {
      try {
        effective = await normalize(prompt);
        agentLog.info(
          { promptLen: prompt.length, normalizedLen: effective.length },
          "normalized",
        );
      } catch (e: any) {
        agentLog.warn(
          { errorLen: e.message?.length ?? 0 },
          "normalizer failed, using raw prompt",
        );
        effective = prompt;
      }
    }

    const route = classify(effective, session.page.url());
    agentLog.info({ promptLen: prompt.length, routeKind: route.kind, reason: route.reason }, "prompt classified");

    const start = Date.now();

    if (route.kind === "direct") {
      try {
        const direct = await executeDirectSteps(session.page, route.steps);
        session.actionCount += direct.steps;
        session.lastActiveAt = Date.now();
        agentLog.info({ durationMs: Date.now() - start, steps: direct.steps, resultLen: direct.result.length }, "direct ok");
        return reply.send({
          result: direct.result,
          steps: direct.steps,
          route: "direct",
          state: {
            url: session.page.url(),
            title: await session.page.title(),
            actionCount: session.actionCount,
          },
        });
      } catch (e: any) {
        agentLog.warn({ errorLen: e.message?.length ?? 0 }, "direct route failed, falling back to AI");
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      return reply.code(400).send({ error: "OPENAI_API_KEY not set" });
    }

    agentLog.info({ promptLen: effective.length }, "agent loop start");
    const result = await agentLoop(session.page, effective, agentLog, undefined, session.history);

    session.actionCount++;
    session.lastActiveAt = Date.now();
    session.history = result.history;

    agentLog.info(
      { durationMs: Date.now() - start, steps: result.steps, resultLen: result.result.length },
      "agent loop done",
    );

    reply.send({
      result: result.result,
      steps: result.steps,
      route: "agent",
      state: {
        url: session.page.url(),
        title: await session.page.title(),
        actionCount: session.actionCount,
      },
    });
  },
);

app.post<{ Params: { id: string }; Body: { prompt: string } }>(
  "/sessions/:id/agent/stream",
  async (req, reply) => {
    const session = getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });

    const { prompt } = req.body;
    if (!prompt) return reply.code(400).send({ error: "prompt is required" });

    const agentLog = child("agent").child({ reqId: req.id, sessionId: session.id });

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const start = Date.now();

    try {
      send("status", { message: "Translating request..." });
      const translatedPrompt = await translatePrompt(prompt);
      
      send("status", { message: "Interpreting request..." });
      const plan = await planRequest(translatedPrompt);
      
      if (plan.kind === "direct") {
        send("status", { message: `Executing direct plan: ${plan.steps[0]?.note || "starting..."}` });
        try {
          for (const step of plan.steps) {
            send("tool_call", { step: 0, tool: step.tool, args: step.args });
          }
          const direct = await executeDirectSteps(session.page, plan.steps);
          session.actionCount += direct.steps;
          session.lastActiveAt = Date.now();
          for (const step of plan.steps) {
            send("tool_result", { step: 0, tool: step.tool, success: true, resultLen: direct.result.length, durationMs: 0 });
          }
          agentLog.info({ durationMs: Date.now() - start, steps: direct.steps, resultLen: direct.result.length }, "direct plan ok");
          send("done", {
            result: direct.result,
            steps: direct.steps,
            route: "direct",
            state: {
              url: session.page.url(),
              title: await session.page.title(),
              actionCount: session.actionCount,
            },
          });
          reply.raw.end();
          return;
        } catch (e: any) {
          agentLog.warn({ error: e.message }, "direct plan failed, falling back to agent loop");
          send("status", { message: "Direct plan failed, engaging AI agent..." });
        }
      }

      if (!process.env.OPENAI_API_KEY) {
        send("error", { error: "OPENAI_API_KEY not set" });
        reply.raw.end();
        return;
      }

      send("status", { message: "Planning complete. AI Agent is taking over..." });
      agentLog.info({ goal: plan.goal }, "agent loop start");
      
      const result = await agentLoop(session.page, plan.goal, agentLog, (event) => {
        send(event.type, event);
      }, session.history);

      session.actionCount++;
      session.lastActiveAt = Date.now();
      session.history = result.history;

      agentLog.info(
        { durationMs: Date.now() - start, steps: result.steps, resultLen: result.result.length },
        "agent loop done",
      );

      send("done", {
        result: result.result,
        steps: result.steps,
        route: "agent",
        state: {
          url: session.page.url(),
          title: await session.page.title(),
          actionCount: session.actionCount,
        },
      });
      reply.raw.end();
    } catch (e: any) {
      send("error", { error: e.message || "An unexpected error occurred during planning" });
      reply.raw.end();
    }
  },
);

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down");
  try {
    await Promise.race([
      (async () => {
        await closeAllSessions();
        await closeAll();
        await app.close();
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (e: any) {
    log.warn({ errorLen: e.message?.length ?? 0 }, "shutdown error");
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.get("/screenshot/*", async (req, reply) => {
  const filePath = (req.params as any)["*"];
  if (!filePath || !existsSync(filePath)) return reply.code(404).send({ error: "File not found" });
  const buf = readFileSync(filePath);
  reply.header("Content-Type", "image/png").send(buf);
});

const uiHtml = readFileSync(join(__dirname, "..", "ui", "index.html"), "utf-8");
app.get("/", async (_req, reply) => reply.type("text/html").send(uiHtml));

const favicon = readFileSync(join(__dirname, "..", "ui", "favicon.svg"));
app.get("/favicon.ico", async (_req, reply) => reply.type("image/svg+xml").send(favicon));
app.get("/favicon.svg", async (_req, reply) => reply.type("image/svg+xml").send(favicon));

warmPool().then(() => {
  app.listen({ port: config.port, host: "0.0.0.0" }).then((addr) => {
    log.info({ addr }, "BrowseAgent ready");
  });
});
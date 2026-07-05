import Fastify from "fastify";
import { config } from "./config.js";
import { createSession, getSession, closeSession, listSessions, startCleanup } from "./session/manager.js";
import { executeAction } from "./agent/executor.js";

const app = Fastify({ logger: false });

startCleanup();

app.post("/sessions", async (_req, reply) => {
  const session = await createSession();
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
  reply.send({ status: "closed" });
});

app.get("/sessions", async (_req, reply) => {
  reply.send(listSessions());
});

app.post<{ Params: { id: string }; Body: { action: { tool: string; args?: Record<string, string> } } }>(
  "/sessions/:id/interact",
  async (req, reply) => {
    const session = getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });

    const { tool, args = {} } = req.body.action;

    const result = await executeAction(session.page, { tool, args });

    session.actionCount++;
    session.lastActiveAt = Date.now();

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

app.listen({ port: config.port, host: "0.0.0.0" }).then(() => {
  console.log(`BrowseAgent API running on http://localhost:${config.port}`);
});

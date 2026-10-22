// Local / self-hosted entry point. For Cloudflare, see worker.js.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { runReview, isAuthorized } from "./review.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

const client = new Anthropic();
const app = express();

app.use((req, res, next) => {
  if (isAuthorized(req.headers.authorization, ACCESS_PASSWORD)) return next();
  res.set("WWW-Authenticate", 'Basic realm="structural-review", charset="UTF-8"').status(401).send("비밀번호가 필요합니다.");
});
app.use(express.json({ limit: "45mb" }));
app.use(express.static(path.join(here, "public")));

app.post("/api/review", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let aborted = false;
  // Proxies such as Cloudflare drop connections idle for ~100s; send a comment line periodically.
  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20000);
  res.on("close", () => {
    aborted = true;
    clearInterval(keepAlive);
  });

  await runReview({
    client,
    model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
    effort: process.env.CLAUDE_EFFORT ?? "high",
    files: req.body?.files,
    project: req.body?.project,
    send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    isAborted: () => aborted,
  });
  clearInterval(keepAlive);
  res.end();
});

app.listen(PORT, () => {
  console.log(`구조설계 법규 검토기: http://localhost:${PORT}`);
});

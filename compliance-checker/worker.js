// Cloudflare Workers entry point. Static files in public/ are served by the
// assets binding (see wrangler.jsonc); this handles /api/* and the password gate.
import Anthropic from "@anthropic-ai/sdk";
import { runReview, isAuthorized } from "./review.js";

const encoder = new TextEncoder();

async function handleReview(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("잘못된 요청입니다.", { status: 400 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  let aborted = false;
  const send = (event, data) => {
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {
      aborted = true;
    });
  };

  // ANTHROPIC_BASE_URL is optional, e.g. to route through Cloudflare AI Gateway.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
  ctx.waitUntil(
    runReview({
      client,
      model: env.CLAUDE_MODEL ?? "claude-opus-5-5",
      effort: env.CLAUDE_EFFORT ?? "high",
      files: body?.files,
      project: body?.project,
      send,
      isAborted: () => aborted,
    }).finally(() => writer.close().catch(() => {})),
  );

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (!isAuthorized(request.headers.get("Authorization"), env.ACCESS_PASSWORD)) {
      return new Response("비밀번호가 필요합니다.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="structural-review", charset="UTF-8"' },
      });
    }
    const url = new URL(request.url);
    if (url.pathname === "/api/review" && request.method === "POST") {
      return handleReview(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};

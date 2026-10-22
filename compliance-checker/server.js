import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, REPORT_SCHEMA, buildUserText } from "./prompt.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const EFFORT = process.env.CLAUDE_EFFORT ?? "high";
// Server-tool turns can pause; resume at most this many times.
const MAX_CONTINUATIONS = 6;

const PDF_TYPE = "application/pdf";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

// Official sources the model may search to confirm the law currently in force.
const LAW_DOMAINS = [
  "law.go.kr",
  "kcsc.re.kr",
  "molit.go.kr",
  "elis.go.kr",
  "eais.go.kr",
];

const client = new Anthropic();
const app = express();
app.use(express.json({ limit: "45mb" }));
app.use(express.static(path.join(here, "public")));

function toContentBlock(file) {
  if (file.mediaType === PDF_TYPE) {
    return {
      type: "document",
      title: file.name,
      source: { type: "base64", media_type: PDF_TYPE, data: file.data },
    };
  }
  if (IMAGE_TYPES.has(file.mediaType)) {
    return {
      type: "image",
      source: { type: "base64", media_type: file.mediaType, data: file.data },
    };
  }
  throw new Error(
    `지원하지 않는 파일 형식입니다: ${file.name} (PDF, PNG, JPG, WEBP, GIF만 가능 — DWG는 PDF로 내보내 주세요)`,
  );
}

// The structured report is the text written after the last search result.
function extractReportText(content) {
  let lastToolResult = -1;
  content.forEach((block, i) => {
    if (block.type.endsWith("_tool_result")) lastToolResult = i;
  });
  return content
    .slice(lastToolResult + 1)
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

app.post("/api/review", async (req, res) => {
  const { files = [], project = {} } = req.body ?? {};

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let aborted = false;
  res.on("close", () => {
    aborted = true;
  });

  try {
    if (files.length === 0) throw new Error("도면 파일을 1개 이상 올려 주세요.");

    const messages = [
      {
        role: "user",
        content: [...files.map(toContentBlock), { type: "text", text: buildUserText(project) }],
      },
    ];

    let final;
    for (let turn = 0; turn <= MAX_CONTINUATIONS && !aborted; turn++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive", display: "summarized" },
        output_config: {
          effort: EFFORT,
          format: { type: "json_schema", schema: REPORT_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 15, allowed_domains: LAW_DOMAINS },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 15, allowed_domains: LAW_DOMAINS },
        ],
        messages,
      });

      const toolInputs = new Map();
      for await (const event of stream) {
        if (aborted) {
          stream.abort();
          break;
        }
        if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
          toolInputs.set(event.index, { name: event.content_block.name, json: "" });
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "thinking_delta") {
            send("thinking", { text: event.delta.thinking });
          } else if (event.delta.type === "input_json_delta" && toolInputs.has(event.index)) {
            toolInputs.get(event.index).json += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop" && toolInputs.has(event.index)) {
          const { name, json } = toolInputs.get(event.index);
          let input = {};
          try {
            input = JSON.parse(json || "{}");
          } catch {}
          send("tool", { name, query: input.query, url: input.url });
        }
      }
      if (aborted) return;

      final = await stream.finalMessage();
      if (final.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: final.content });
      send("status", { text: "법령 확인을 계속하는 중…" });
    }

    if (final.stop_reason === "refusal") {
      throw new Error("모델이 이 요청의 검토를 거절했습니다. 파일 내용을 확인한 뒤 다시 시도해 주세요.");
    }
    if (final.stop_reason === "max_tokens") {
      throw new Error("검토 결과가 너무 길어 잘렸습니다. 도면을 나눠서 올려 주세요.");
    }
    if (final.stop_reason === "pause_turn") {
      throw new Error("법령 검색이 너무 길어져 중단되었습니다. 다시 시도해 주세요.");
    }

    const text = extractReportText(final.content);
    let report;
    try {
      report = JSON.parse(text);
    } catch {
      send("raw", { text });
      return;
    }
    send("report", report);
  } catch (err) {
    console.error(err);
    let message = err.message;
    if (err instanceof Anthropic.AuthenticationError) message = "API 키가 올바르지 않습니다 (ANTHROPIC_API_KEY 확인).";
    else if (err instanceof Anthropic.RateLimitError) message = "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.";
    else if (err instanceof Anthropic.BadRequestError) message = `요청 오류: ${err.message}`;
    else if (err instanceof Anthropic.APIError) message = `API 오류 (${err.status}): ${err.message}`;
    send("error", { message });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`구조설계 법규 검토기: http://localhost:${PORT}`);
});

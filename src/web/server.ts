import "dotenv/config";
import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CHAIN_SLUGS } from "../chains.js";
import type { ChainSlug } from "../types.js";
import { defaultAdapters } from "../adapters/index.js";
import { trace } from "../trace.js";
import { toMermaid } from "../graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const PORT = Number(process.env.PORT ?? 4001);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** undefined = "not provided, use the default"; string = validation error message. */
function parsePositiveInt(value: unknown, name: string): number | undefined | string {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return `${name} must be a positive number`;
  return n;
}

// The page is static — read it once at startup instead of on every request.
const indexHtml = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexHtml);
      return;
    }

    if (req.method === "GET" && req.url === "/api/chains") {
      sendJson(res, 200, CHAIN_SLUGS);
      return;
    }

    if (req.method === "POST" && req.url === "/api/trace") {
      const body = await readBody(req);
      let input: { chain?: string; txHash?: string; maxHops?: unknown; fanOut?: unknown };
      try {
        input = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const { chain, txHash, maxHops: maxHopsIn, fanOut: fanOutIn } = input;
      if (!chain || !CHAIN_SLUGS.includes(chain as ChainSlug)) {
        sendJson(res, 400, { error: `chain must be one of: ${CHAIN_SLUGS.join(", ")}` });
        return;
      }
      if (!txHash || typeof txHash !== "string") {
        sendJson(res, 400, { error: "txHash is required" });
        return;
      }

      const maxHops = parsePositiveInt(maxHopsIn, "maxHops");
      if (typeof maxHops === "string") {
        sendJson(res, 400, { error: maxHops });
        return;
      }
      const fanOut = parsePositiveInt(fanOutIn, "fanOut");
      if (typeof fanOut === "string") {
        sendJson(res, 400, { error: fanOut });
        return;
      }

      const result = await trace(defaultAdapters, chain as ChainSlug, txHash, {
        maxHops,
        fanOut,
        etherscanApiKey: process.env.ETHERSCAN_API_KEY,
        solanaRpcUrl: process.env.SOLANA_RPC_URL,
      });

      sendJson(res, 200, { ...result, mermaid: toMermaid(result.root) });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
  }
});

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`bridgetrail web UI: http://localhost:${PORT}`);
  if (!process.env.ETHERSCAN_API_KEY) {
    console.log("Note: ETHERSCAN_API_KEY not set — multi-hop tracing will stop after the first hop.");
  }
});

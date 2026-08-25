import "dotenv/config";
import { createServer } from "node:http";
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

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && req.url === "/api/chains") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(CHAIN_SLUGS));
      return;
    }

    if (req.method === "POST" && req.url === "/api/trace") {
      const body = await readBody(req);
      let input: { chain?: string; txHash?: string; maxHops?: number; fanOut?: number };
      try {
        input = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      const { chain, txHash, maxHops, fanOut } = input;
      if (!chain || !CHAIN_SLUGS.includes(chain as ChainSlug)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `chain must be one of: ${CHAIN_SLUGS.join(", ")}` }));
        return;
      }
      if (!txHash || typeof txHash !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "txHash is required" }));
        return;
      }

      const result = await trace(defaultAdapters, chain as ChainSlug, txHash, {
        maxHops: maxHops ?? 5,
        fanOut: fanOut ?? 5,
        etherscanApiKey: process.env.ETHERSCAN_API_KEY,
        solanaRpcUrl: process.env.SOLANA_RPC_URL,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...result, mermaid: toMermaid(result.root) }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
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

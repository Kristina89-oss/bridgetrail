#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { CHAIN_SLUGS } from "./chains.js";
import type { ChainSlug } from "./types.js";
import { defaultAdapters } from "./adapters/index.js";
import { trace } from "./trace.js";
import { toMermaid } from "./graph.js";

const program = new Command();

program
  .name("bridgetrail")
  .description(
    "Recursively trace a transaction across cross-chain bridges using each " +
      "protocol's own public status API (LI.FI, Wormhole, Axelar, LayerZero, deBridge).",
  )
  .version("0.1.0");

program
  .command("trace")
  .description("Trace a single transaction forward across bridge hops")
  .argument("<chain>", `source chain (${CHAIN_SLUGS.join(", ")})`)
  .argument("<txHash>", "source transaction hash")
  .option("-d, --max-hops <n>", "maximum number of hops to follow", "5")
  .option("-f, --fan-out <n>", "recent txs to probe per landing address", "5")
  .option("-o, --out <file>", "write JSON trace to this file (default: stdout)")
  .option("-g, --graph <file>", "also write a Mermaid graph to this file")
  .action(async (chainArg: string, txHash: string, opts) => {
    const chain = chainArg as ChainSlug;
    if (!CHAIN_SLUGS.includes(chain)) {
      console.error(`Unknown chain "${chainArg}". Supported: ${CHAIN_SLUGS.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    const result = await trace(defaultAdapters, chain, txHash, {
      maxHops: Number(opts.maxHops),
      fanOut: Number(opts.fanOut),
      etherscanApiKey: process.env.ETHERSCAN_API_KEY,
      solanaRpcUrl: process.env.SOLANA_RPC_URL,
    });

    const json = JSON.stringify(result, null, 2);
    if (opts.out) {
      writeFileSync(opts.out, json);
      console.error(`Wrote trace to ${opts.out}`);
    } else {
      console.log(json);
    }

    if (opts.graph) {
      writeFileSync(opts.graph, toMermaid(result.root));
      console.error(`Wrote Mermaid graph to ${opts.graph}`);
    }

    for (const warning of result.warnings) {
      console.error(`Warning: ${warning}`);
    }
  });

program.parseAsync();

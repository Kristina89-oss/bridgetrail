import type { BridgeAdapter, ChainSlug, Hop, TraceNode, TraceResult } from "./types.js";
import { isEvm } from "./chains.js";
import { getRecentTransactions } from "./explorer/etherscan.js";
import { getRecentSignatures } from "./explorer/solana.js";

export interface TraceOptions {
  maxHops?: number;
  /** How many of an address's most recent transactions to probe for a
   * re-bridge when a hop only gives us a destination address (no dest tx). */
  fanOut?: number;
  etherscanApiKey?: string;
  solanaRpcUrl?: string;
}

async function resolveWithAdapters(
  adapters: BridgeAdapter[],
  chain: ChainSlug,
  txHash: string,
): Promise<Hop | null> {
  for (const adapter of adapters) {
    if (!adapter.supportsChain(chain)) continue;
    const hop = await adapter.resolve({ chain, txHash });
    if (hop) return hop;
  }
  return null;
}

/** Candidate next-hop tx hashes to probe from a landing address, when the
 * resolved hop didn't give us a destination tx hash directly. */
async function candidateTxsFromAddress(
  chain: ChainSlug,
  address: string,
  opts: TraceOptions,
): Promise<string[]> {
  if (isEvm(chain)) {
    const txs = await getRecentTransactions(
      chain,
      address,
      opts.etherscanApiKey,
      opts.fanOut ?? 5,
    );
    return txs.filter((t) => t.isError === "0").map((t) => t.hash);
  }
  const sigs = await getRecentSignatures(address, opts.solanaRpcUrl, opts.fanOut ?? 5);
  return sigs.filter((s) => !s.err).map((s) => s.signature);
}

export async function trace(
  adapters: BridgeAdapter[],
  rootChain: ChainSlug,
  rootTx: string,
  options: TraceOptions = {},
): Promise<TraceResult> {
  const maxHops = options.maxHops ?? 5;
  const hops: Hop[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>();

  async function expand(node: TraceNode, depth: number): Promise<void> {
    const key = `${node.chain}:${node.tx}`;
    if (visited.has(key)) {
      node.stopReason = "cycle";
      return;
    }
    visited.add(key);

    if (depth >= maxHops) {
      node.stopReason = "max-depth";
      return;
    }

    const hop = await resolveWithAdapters(adapters, node.chain, node.tx);
    if (!hop) {
      node.stopReason = "no-bridge-match";
      return;
    }
    hops.push(hop);

    if (hop.confidence !== "confirmed" || !hop.destChain) {
      // Bridge match found, but not (yet) resolvable to a landing point.
      return;
    }

    if (hop.destTx) {
      const child: TraceNode = { chain: hop.destChain, tx: hop.destTx, hop, children: [] };
      node.children.push(child);
      await expand(child, depth + 1);
      return;
    }

    if (hop.destAddress) {
      const candidates = await candidateTxsFromAddress(hop.destChain, hop.destAddress, options);
      if (candidates.length === 0) {
        const leaf: TraceNode = {
          chain: hop.destChain,
          tx: "",
          address: hop.destAddress,
          hop,
          children: [],
          stopReason: isEvm(hop.destChain) && !options.etherscanApiKey
            ? "no-explorer-key"
            : "no-bridge-match",
        };
        node.children.push(leaf);
        if (isEvm(hop.destChain) && !options.etherscanApiKey) {
          warnings.push(
            `No ETHERSCAN_API_KEY set — could not check ${hop.destAddress} on ${hop.destChain} for a re-bridge.`,
          );
        }
        return;
      }
      for (const candidateTx of candidates) {
        const child: TraceNode = {
          chain: hop.destChain,
          tx: candidateTx,
          address: hop.destAddress,
          hop,
          children: [],
        };
        node.children.push(child);
        await expand(child, depth + 1);
      }
    }
  }

  const root: TraceNode = { chain: rootChain, tx: rootTx, children: [] };
  await expand(root, 0);

  return { root, hops, warnings };
}

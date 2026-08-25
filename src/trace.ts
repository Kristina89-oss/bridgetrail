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

const DEFAULT_MAX_HOPS = 5;
const DEFAULT_FAN_OUT = 5;
const HARD_MAX_HOPS = 25; // sanity ceiling even for an explicit caller value
const HARD_MAX_FAN_OUT = 50;

/** A caller (CLI flag, HTTP body) can hand us anything — NaN, a string, a
 * negative number. Silently falling through to `depth >= NaN` (always false)
 * would disable the recursion-depth guard entirely instead of erroring or
 * falling back, so every path into `trace()` normalizes through here. */
function normalizePositiveInt(value: number | undefined, fallback: number, hardMax: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), hardMax);
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

interface CandidateLookup {
  /** false means the lookup itself failed — distinct from "looked up, found nothing". */
  ok: boolean;
  txHashes: string[];
}

/** Candidate next-hop tx hashes to probe from a landing address, when the
 * resolved hop didn't give us a destination tx hash directly. */
async function candidateTxsFromAddress(
  chain: ChainSlug,
  address: string,
  opts: TraceOptions,
  fanOut: number,
): Promise<CandidateLookup> {
  if (isEvm(chain)) {
    const { ok, txs } = await getRecentTransactions(chain, address, opts.etherscanApiKey, fanOut);
    return { ok, txHashes: txs.filter((t) => t.isError === "0").map((t) => t.hash) };
  }
  const { ok, signatures } = await getRecentSignatures(address, opts.solanaRpcUrl, fanOut);
  return { ok, txHashes: signatures.filter((s) => !s.err).map((s) => s.signature) };
}

export async function trace(
  adapters: BridgeAdapter[],
  rootChain: ChainSlug,
  rootTx: string,
  options: TraceOptions = {},
): Promise<TraceResult> {
  const maxHops = normalizePositiveInt(options.maxHops, DEFAULT_MAX_HOPS, HARD_MAX_HOPS);
  const fanOut = normalizePositiveInt(options.fanOut, DEFAULT_FAN_OUT, HARD_MAX_FAN_OUT);
  const hops: Hop[] = [];
  const warnings: string[] = [];

  // Cycle detection is scoped to the current root->node ANCESTOR path, not
  // shared globally across the whole trace. Two unrelated branches that both
  // happen to land on the same tx (e.g. the same address reached via two
  // different upstream hops) are not a cycle — they're convergence, and
  // mislabeling them "cycle" would read to an investigator as false evidence
  // of circular fund movement. The tradeoff: a tx reached via multiple
  // sibling branches gets re-expanded once per branch instead of once
  // total; bounded by maxHops/fanOut, so this stays finite.
  async function expand(node: TraceNode, depth: number, ancestors: ReadonlySet<string>): Promise<void> {
    const key = `${node.chain}:${node.tx}`;
    if (ancestors.has(key)) {
      node.stopReason = "cycle";
      return;
    }

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
      // Bridge match found, but not (yet) resolvable to a landing point —
      // record that explicitly rather than leaving the node looking
      // unexamined (see types.ts's "unresolved-hop").
      node.stopReason = "unresolved-hop";
      return;
    }

    const childAncestors = new Set(ancestors);
    childAncestors.add(key);

    if (hop.destTx) {
      const child: TraceNode = { chain: hop.destChain, tx: hop.destTx, hop, children: [] };
      node.children.push(child);
      await expand(child, depth + 1, childAncestors);
      return;
    }

    if (hop.destAddress) {
      const lookup = await candidateTxsFromAddress(hop.destChain, hop.destAddress, options, fanOut);

      if (!lookup.ok) {
        const noKey = isEvm(hop.destChain) && !options.etherscanApiKey;
        const leaf: TraceNode = {
          chain: hop.destChain,
          tx: "",
          address: hop.destAddress,
          hop,
          children: [],
          stopReason: noKey ? "no-explorer-key" : "explorer-lookup-failed",
        };
        node.children.push(leaf);
        warnings.push(
          noKey
            ? `No ETHERSCAN_API_KEY set — could not check ${hop.destAddress} on ${hop.destChain} for a re-bridge.`
            : `Address lookup failed for ${hop.destAddress} on ${hop.destChain} — could not check for a re-bridge (not a confirmed dead end).`,
        );
        return;
      }

      if (lookup.txHashes.length === 0) {
        node.children.push({
          chain: hop.destChain,
          tx: "",
          address: hop.destAddress,
          hop,
          children: [],
          stopReason: "no-bridge-match",
        });
        return;
      }

      const children = lookup.txHashes.map((candidateTx) => {
        const child: TraceNode = {
          chain: hop.destChain!,
          tx: candidateTx,
          address: hop.destAddress,
          hop,
          children: [],
        };
        node.children.push(child);
        return child;
      });
      await Promise.all(children.map((child) => expand(child, depth + 1, childAncestors)));
    }
  }

  const root: TraceNode = { chain: rootChain, tx: rootTx, children: [] };
  await expand(root, 0, new Set());

  return { root, hops, warnings };
}

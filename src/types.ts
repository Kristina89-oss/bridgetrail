/** Chain slugs supported by bridgetrail in v1. */
export type ChainSlug =
  | "ethereum"
  | "arbitrum"
  | "optimism"
  | "base"
  | "polygon"
  | "bsc"
  | "avalanche"
  | "solana";

export type Confidence = "confirmed" | "unresolved";

/** A single bridge hop resolved via a protocol's own public status API. */
export interface Hop {
  /** Adapter that resolved this hop, e.g. "lifi", "wormhole", "axelar". */
  bridge: string;
  sourceChain: ChainSlug;
  sourceTx: string;
  sourceAddress?: string;
  destChain?: ChainSlug;
  destTx?: string;
  destAddress?: string;
  amount?: string;
  token?: string;
  confidence: Confidence;
  /** Raw response from the bridge API, kept for audit / evidence purposes. */
  raw?: unknown;
}

export interface ResolveInput {
  chain: ChainSlug;
  txHash: string;
}

/** One protocol integration. Each adapter asks its own indexer "do you know
 * this tx?" instead of us locally decoding contract logs — the bridge's own
 * indexer is the source of truth and survives contract upgrades. */
export interface BridgeAdapter {
  name: string;
  supportsChain(chain: ChainSlug): boolean;
  /** Returns null if this protocol has no record of the tx (not an error). */
  resolve(input: ResolveInput): Promise<Hop | null>;
}

export interface TraceNode {
  chain: ChainSlug;
  tx: string;
  address?: string;
  /** The hop that led INTO this node. Undefined for the root node. */
  hop?: Hop;
  children: TraceNode[];
  /** Set when we stopped expanding this node (max depth, cycle, no adapter match). */
  stopReason?: "max-depth" | "cycle" | "no-bridge-match" | "no-explorer-key";
}

export interface TraceResult {
  root: TraceNode;
  hops: Hop[];
  warnings: string[];
}

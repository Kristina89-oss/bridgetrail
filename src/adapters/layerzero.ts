import type { BridgeAdapter, ChainSlug, Hop, ResolveInput } from "../types.js";
import { fetchJson } from "../http.js";

/**
 * LayerZero V2 Scan API. Verified live on 2026-08-25 for the "not found"
 * case: `GET https://scan.layerzero-api.com/v1/messages/tx/{txHash}` ->
 * HTTP 404 `{ "message": "Message not found for tx ...", "code": 4040 }`.
 *
 * The populated-response shape below (`data[]` with `pathway`/`source`/
 * `destination`) follows LayerZero's own docs
 * (https://docs.layerzero.network/v2/tools/layerzeroscan/api), but a real
 * example JSON body was not available to verify field-for-field in this
 * session — the swagger UI needs a live tx hash to render one. Parsing is
 * written defensively (multiple fallback paths) and chain identification
 * falls back to the raw chain name/eid string when it doesn't match our
 * registry, so a schema drift degrades to "unresolved" rather than throwing.
 * Verify against https://layerzeroscan.com before relying on this for
 * evidence-grade output.
 */
interface LzTxRef {
  txHash?: string;
  chain?: string; // e.g. "ethereum"
}

interface LzEndpoint {
  chain?: string;
  address?: string;
}

interface LzMessage {
  pathway?: { srcEid?: number; dstEid?: number; sender?: LzEndpoint; receiver?: LzEndpoint };
  source?: { status?: string; tx?: LzTxRef; chain?: string };
  destination?: { status?: string; tx?: LzTxRef; chain?: string };
  status?: { name?: string };
  guid?: string;
}

// LayerZero V2 chain names as used in scan responses (lowercase, matches our slugs 1:1
// for the chains we support except a couple of aliases).
const LZ_CHAIN_ALIASES: Record<string, ChainSlug> = {
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  optimism: "optimism",
  base: "base",
  polygon: "polygon",
  bsc: "bsc",
  bnb: "bsc",
  avalanche: "avalanche",
};

function toSlug(name?: string): ChainSlug | undefined {
  if (!name) return undefined;
  return LZ_CHAIN_ALIASES[name.toLowerCase()];
}

export const layerzeroAdapter: BridgeAdapter = {
  name: "layerzero",
  supportsChain(chain) {
    return chain !== "solana";
  },
  async resolve({ chain, txHash }: ResolveInput): Promise<Hop | null> {
    if (chain === "solana") return null;

    let data: { data?: LzMessage[] } | LzMessage[];
    try {
      data = await fetchJson(
        `https://scan.layerzero-api.com/v1/messages/tx/${encodeURIComponent(txHash)}`,
      );
    } catch {
      return null;
    }

    const msg = Array.isArray(data) ? data[0] : data.data?.[0];
    if (!msg) return null;

    const destChain = toSlug(msg.destination?.chain ?? msg.pathway?.receiver?.chain);
    const destTx = msg.destination?.tx?.txHash;
    const delivered =
      msg.destination?.status?.toUpperCase() === "SUCCEEDED" ||
      msg.status?.name?.toUpperCase() === "DELIVERED";

    return {
      bridge: "layerzero",
      sourceChain: chain,
      sourceTx: txHash,
      sourceAddress: msg.pathway?.sender?.address,
      destChain,
      destTx: delivered ? destTx : undefined,
      destAddress: msg.pathway?.receiver?.address,
      confidence: delivered && destTx ? "confirmed" : "unresolved",
      raw: msg,
    };
  },
};

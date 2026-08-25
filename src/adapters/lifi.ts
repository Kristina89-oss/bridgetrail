import type { BridgeAdapter, ChainSlug, Hop, ResolveInput } from "../types.js";
import { LIFI_CHAIN_ID } from "../chains.js";
import { fetchJson } from "../http.js";
import { sameTxHash } from "../txhash.js";

/**
 * LI.FI (https://li.quest) is a bridge/DEX aggregator whose public `/v1/status`
 * endpoint reports the outcome of transfers it routed — covering Across,
 * Stargate, Hop, Synapse, cBridge, and others through one call. Verified live
 * against the real API on 2026-08-25: `GET /v1/status?txHash=<hash>` returns
 * `sending`/`receiving` objects with chainId, txHash, token, amount, plus a
 * `tool` field naming the underlying bridge.
 *
 * IMPORTANT (two issues found via live multi-hop testing, not just docs):
 * 1. A malformed/unmatched txHash does NOT reliably come back as "not
 *    found" — it can return an unrelated transfer. We verify the response
 *    echoes the requested hash before trusting it.
 * 2. The endpoint matches txHash against EITHER leg of a transfer — querying
 *    with a transfer's *destination* tx returns the same record as querying
 *    with its *source* tx. Naively treating any match as "found a new hop
 *    starting here" causes a self-referential hop (destChain/destTx equal to
 *    the input) when you ask about a tx that's already a landing point. We
 *    only treat this as a hop if `sending.txHash` — the source leg — matches
 *    the input; a match only on `receiving` means "this tx is where a
 *    transfer arrived", which isn't a new outbound hop.
 */
interface LifiTxInfo {
  txHash: string;
  chainId: number;
  amount?: string;
  timestamp?: number;
  token?: { symbol?: string; address?: string; decimals?: number };
}

interface LifiStatusResponse {
  status?: string; // NOT_FOUND | INVALID | PENDING | DONE | FAILED
  substatus?: string;
  tool?: string;
  sending?: LifiTxInfo;
  receiving?: LifiTxInfo;
  fromAddress?: string;
  toAddress?: string;
}

const chainIdToSlug: Record<number, ChainSlug> = Object.fromEntries(
  Object.entries(LIFI_CHAIN_ID).map(([slug, id]) => [id, slug as ChainSlug]),
);

export const lifiAdapter: BridgeAdapter = {
  name: "lifi",
  supportsChain(chain) {
    return chain in LIFI_CHAIN_ID;
  },
  async resolve({ chain, txHash }: ResolveInput): Promise<Hop | null> {
    const chainId = LIFI_CHAIN_ID[chain];
    if (chainId === undefined) return null;

    let data: LifiStatusResponse;
    try {
      data = await fetchJson<LifiStatusResponse>(
        `https://li.quest/v1/status?txHash=${encodeURIComponent(txHash)}&fromChain=${chainId}`,
      );
    } catch {
      return null;
    }

    if (!data.status || data.status === "NOT_FOUND" || data.status === "INVALID") {
      return null;
    }

    if (!sameTxHash(data.sending?.txHash, txHash, chain)) {
      // Either the API returned something unrelated to our tx (discard), or
      // the input tx is the *destination* leg of a known transfer, not a
      // new outbound hop starting here (also discard — see class comment).
      return null;
    }

    const receiving = data.receiving;
    const destChain = receiving ? chainIdToSlug[receiving.chainId] : undefined;
    const done = data.status === "DONE" && Boolean(receiving?.txHash);

    return {
      bridge: `lifi:${data.tool ?? "unknown"}`,
      sourceChain: chain,
      sourceTx: txHash,
      sourceAddress: data.fromAddress,
      destChain,
      destTx: done ? receiving?.txHash : undefined,
      destAddress: data.toAddress,
      amount: receiving?.amount ?? data.sending?.amount,
      token: receiving?.token?.symbol ?? data.sending?.token?.symbol,
      confidence: done ? "confirmed" : "unresolved",
      raw: data,
    };
  },
};

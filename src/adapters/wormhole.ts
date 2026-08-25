import type { BridgeAdapter, ChainSlug, Hop, ResolveInput } from "../types.js";
import { WORMHOLE_CHAIN_ID } from "../chains.js";
import { fetchJson } from "../http.js";

/**
 * Wormholescan public API. Verified live on 2026-08-25 against both an empty
 * result and a real in-flight transfer:
 * `GET /api/v1/operations?txHash=<hash>` -> `{ "operations": [{ ... }] }`.
 *
 * Confirmed real shape: `sourceChain.chainId` / `sourceChain.transaction.txHash`,
 * and `content.standarizedProperties.{fromChain,toChain,fromAddress,toAddress,amount}`
 * (note Wormhole's own spelling: "standarizedProperties", no `e`). A
 * `targetChain` object with the destination tx only appears once the transfer
 * has actually been redeemed on the destination chain — for in-flight or
 * relayer-model transfers it's absent, so `standarizedProperties.toChain` is
 * the more reliable destination-chain signal and is used as the primary
 * source here, with `targetChain.transaction.txHash` layered on top when present.
 */
interface WormholeOperation {
  sourceChain?: { chainId?: number; transaction?: { txHash?: string } };
  targetChain?: { chainId?: number; transaction?: { txHash?: string } };
  content?: {
    standarizedProperties?: {
      fromChain?: number;
      toChain?: number;
      fromAddress?: string;
      toAddress?: string;
      amount?: string;
    };
  };
}

interface WormholeOperationsResponse {
  operations?: WormholeOperation[];
}

const chainIdToSlug: Record<number, ChainSlug> = Object.fromEntries(
  Object.entries(WORMHOLE_CHAIN_ID).map(([slug, id]) => [id, slug as ChainSlug]),
);

export const wormholeAdapter: BridgeAdapter = {
  name: "wormhole",
  supportsChain(chain) {
    return chain in WORMHOLE_CHAIN_ID;
  },
  async resolve({ chain, txHash }: ResolveInput): Promise<Hop | null> {
    if (!(chain in WORMHOLE_CHAIN_ID)) return null;

    let data: WormholeOperationsResponse;
    try {
      data = await fetchJson<WormholeOperationsResponse>(
        `https://api.wormholescan.io/api/v1/operations?txHash=${encodeURIComponent(txHash)}`,
      );
    } catch {
      return null;
    }

    const op = data.operations?.[0];
    if (!op) return null;

    const props = op.content?.standarizedProperties;
    const destChainId = op.targetChain?.chainId ?? props?.toChain;
    const destChain = destChainId !== undefined ? chainIdToSlug[destChainId] : undefined;
    const destTx = op.targetChain?.transaction?.txHash;

    return {
      bridge: "wormhole",
      sourceChain: chain,
      sourceTx: txHash,
      sourceAddress: props?.fromAddress || undefined,
      destChain,
      destTx,
      destAddress: props?.toAddress || undefined,
      amount: props?.amount,
      confidence: destTx ? "confirmed" : "unresolved",
      raw: op,
    };
  },
};

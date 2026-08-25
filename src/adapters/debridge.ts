import type { BridgeAdapter, ChainSlug, Hop, ResolveInput } from "../types.js";
import { EVM_CHAIN_ID } from "../chains.js";
import { fetchJson } from "../http.js";

/**
 * deBridge DLN API. Verified live on 2026-08-25 against the real OpenAPI
 * spec (https://dln.debridge.finance/v1.0-json) and a live call:
 * `GET /v1.0/dln/tx/{hash}/order-ids` -> `{ "orderIds": [...] }` (confirmed
 * live, empty array for an unknown hash), then
 * `GET /v1.0/dln/order/{id}` -> `{ orderId, status, orderStruct }` where
 * `orderStruct.giveOffer.chainId` / `takeOffer.chainId` are deBridge's own
 * numeric chain IDs (mostly standard EVM chain IDs, but Solana is the
 * deBridge-specific id 7565164 — confirmed from the spec's enum, not
 * standard EVM). `status` is one of None/Created/Fulfilled/SentUnlock/
 * OrderCancelled/SentOrderCancel/ClaimedUnlock/ClaimedOrderCancel.
 *
 * NOTE: the order object has no destination *transaction hash* field, only
 * destination chain + receiver address + fulfilment status — so `destTx` is
 * always left undefined for this adapter. That's still enough to continue a
 * trace (chain + address), just not enough to point at one specific tx.
 */
// deBridge uses standard EVM chain IDs for EVM chains — derived from
// EVM_CHAIN_ID (string-keyed, since the DLN API returns chainId as a string)
// rather than duplicated, plus deBridge's own non-standard Solana ID.
const DEBRIDGE_CHAIN_ID: Record<string, ChainSlug> = {
  ...Object.fromEntries(
    Object.entries(EVM_CHAIN_ID).map(([slug, id]) => [String(id), slug as ChainSlug]),
  ),
  "7565164": "solana",
};

interface DlnOffer {
  chainId?: string;
  tokenAddress?: string;
  amount?: number | string;
}

interface DlnOrderStruct {
  makerSrc?: string;
  giveOffer?: DlnOffer;
  takeOffer?: DlnOffer;
  receiverDst?: string;
}

interface DlnOrderResponse {
  orderId?: string;
  status?: string;
  orderStruct?: DlnOrderStruct;
}

const FULFILLED_STATUSES = new Set(["Fulfilled", "SentUnlock", "ClaimedUnlock"]);

export const debridgeAdapter: BridgeAdapter = {
  name: "debridge",
  supportsChain(chain) {
    return Object.values(DEBRIDGE_CHAIN_ID).includes(chain);
  },
  async resolve({ chain, txHash }: ResolveInput): Promise<Hop | null> {
    let orderIdsRes: { orderIds?: string[] };
    try {
      orderIdsRes = await fetchJson(
        `https://dln.debridge.finance/v1.0/dln/tx/${encodeURIComponent(txHash)}/order-ids`,
      );
    } catch {
      return null;
    }

    const orderId = orderIdsRes.orderIds?.[0];
    if (!orderId) return null;

    let order: DlnOrderResponse;
    try {
      order = await fetchJson(
        `https://dln.debridge.finance/v1.0/dln/order/${encodeURIComponent(orderId)}`,
      );
    } catch {
      return null;
    }

    const struct = order.orderStruct;
    const destChainId = struct?.takeOffer?.chainId;
    const destChain = destChainId ? DEBRIDGE_CHAIN_ID[destChainId] : undefined;
    const fulfilled = order.status ? FULFILLED_STATUSES.has(order.status) : false;

    return {
      bridge: "debridge",
      sourceChain: chain,
      sourceTx: txHash,
      sourceAddress: struct?.makerSrc,
      destChain,
      destTx: undefined, // not exposed by this API — see note above
      destAddress: struct?.receiverDst,
      amount: struct?.takeOffer?.amount !== undefined ? String(struct.takeOffer.amount) : undefined,
      confidence: fulfilled && destChain ? "confirmed" : "unresolved",
      raw: order,
    };
  },
};

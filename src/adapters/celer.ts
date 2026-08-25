import type { BridgeAdapter, ChainSlug, Hop, ResolveInput } from "../types.js";
import { EVM_CHAIN_ID } from "../chains.js";
import { fetchJson } from "../http.js";
import { sameTxHash } from "../txhash.js";

/**
 * Celer cBridge. Verified live on 2026-08-25: `getTransferStatus` normally
 * takes a `transfer_id` (a hash computed from sender/receiver/token/amount/
 * chain-ids/nonce — not the tx hash — which would require decoding the
 * source tx's `Send` event locally, breaking the "ask the protocol's own
 * indexer" pattern used everywhere else in this project). However, posting
 * `{ tx_hash, src_chain_id }` instead of `transfer_id` was ALSO accepted —
 * it passed request validation and reached real business logic
 * (`{"err":{"code":500,"msg":"transfer not found"}}` for an unknown hash,
 * same shape `getTransferStatus` gives for an unknown transfer_id). This
 * looks like an (undocumented) convenience path, so it's used here.
 *
 * CAVEAT: only the "not found" case was confirmed live — no real Celer
 * transfer was available to verify a populated response. The field mapping
 * below (`status` as a numeric enum, `dst_block_tx_link` holding a URL with
 * the destination tx hash as its last path segment) is reconstructed from
 * Celer's public docs/SDKs and is NOT independently re-verified here.
 * Treat any populated result from this adapter with extra caution, and
 * check against https://cbridge.celer.network before relying on it.
 *
 * Unlike the other adapters, `CbridgeStatusResponse` has no field that
 * echoes the request, so the same "does this response actually match what
 * we asked about" guard used elsewhere isn't directly available. `src_block_tx_link`
 * is the closest thing to one: when present, it's expected to point back at
 * the source tx we queried with, so we check it and discard the response if
 * it points somewhere else. This catches an obviously wrong/self-referential
 * response but is weaker than the other adapters' guards, since the field
 * is optional and its presence/meaning isn't confirmed live.
 */
const CELER_STATUS_COMPLETED = 5; // TRANSFER_COMPLETED, per Celer's documented enum

interface CbridgeStatusResponse {
  status?: number;
  src_block_tx_link?: string;
  dst_block_tx_link?: string;
  err?: { code?: number; msg?: string };
}

function txHashFromLink(link?: string): string | undefined {
  if (!link) return undefined;
  const match = link.match(/0x[0-9a-fA-F]{64}/);
  return match?.[0];
}

// cBridge's own explorer links are the only destination-chain signal
// available from this response shape — inferred from the block explorer
// domain they point to.
const EXPLORER_HOST_TO_CHAIN: Record<string, ChainSlug> = {
  "etherscan.io": "ethereum",
  "arbiscan.io": "arbitrum",
  "optimistic.etherscan.io": "optimism",
  "basescan.org": "base",
  "polygonscan.com": "polygon",
  "bscscan.com": "bsc",
  "snowtrace.io": "avalanche",
};

function chainFromLink(link?: string): ChainSlug | undefined {
  if (!link) return undefined;
  try {
    return EXPLORER_HOST_TO_CHAIN[new URL(link).hostname.replace(/^www\./, "")];
  } catch {
    return undefined;
  }
}

export const celerAdapter: BridgeAdapter = {
  name: "celer",
  supportsChain(chain) {
    return chain in EVM_CHAIN_ID;
  },
  async resolve({ chain, txHash }: ResolveInput): Promise<Hop | null> {
    const chainId = EVM_CHAIN_ID[chain];
    if (chainId === undefined) return null;

    let data: CbridgeStatusResponse;
    try {
      data = await fetchJson<CbridgeStatusResponse>(
        "https://cbridge-prod2.celer.app/v2/getTransferStatus",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tx_hash: txHash, src_chain_id: chainId }),
        },
      );
    } catch {
      return null;
    }

    if (data.err || data.status === undefined) return null;

    const srcTxInResponse = txHashFromLink(data.src_block_tx_link);
    if (srcTxInResponse && !sameTxHash(srcTxInResponse, txHash, chain)) return null;

    const destTx = txHashFromLink(data.dst_block_tx_link);
    const destChain = chainFromLink(data.dst_block_tx_link);
    const completed = data.status === CELER_STATUS_COMPLETED;

    return {
      bridge: "celer",
      sourceChain: chain,
      sourceTx: txHash,
      destChain: completed ? destChain : undefined,
      destTx: completed ? destTx : undefined,
      confidence: completed && destTx && destChain ? "confirmed" : "unresolved",
      raw: data,
    };
  },
};

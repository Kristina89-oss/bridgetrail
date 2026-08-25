import type { BridgeAdapter, ChainSlug, Hop, ResolveInput } from "../types.js";
import { AXELAR_CHAIN_NAME } from "../chains.js";
import { fetchJson } from "../http.js";

/**
 * Axelarscan GMP API. Verified live on 2026-08-25, including a fully
 * `executed` record: `POST https://api.axelarscan.io/gmp/searchGMP` with
 * body `{ "txHash": "<hash>" }` -> `{ "data": [...], "total": N }`. No API
 * key required.
 *
 * Confirmed real shape: `data[0].call.{chain,transactionHash,returnValues:
 * {sender,destinationChain,destinationContractAddress}}` for the source
 * side, and `data[0].executed.{chain,transactionHash}` for the destination
 * side once `status === "executed"`. Axelar mixes chain-name casing between
 * fields (e.g. "Ethereum" in `returnValues.destinationChain` vs "ethereum"
 * in `executed.chain`) — matched case-insensitively here. GMP payloads are
 * application-specific, so there's no generic "recipient wallet" field; we
 * surface `destinationContractAddress` (the messaged contract) as the closest
 * available proxy and flag it as such.
 *
 * `searchGMP` isn't documented as scoping strictly to the *source* tx hash,
 * so — same guard as the LI.FI and Wormhole adapters — we only treat this as
 * a hop if `call.transactionHash` matches the request; a match only on
 * `executed.transactionHash` would mean the input is already a landing
 * point, not a new outbound hop.
 */
interface AxelarGmpRecord {
  call?: {
    chain?: string;
    transactionHash?: string;
    returnValues?: {
      sender?: string;
      destinationChain?: string;
      destinationContractAddress?: string;
      amount?: string;
      symbol?: string;
    };
  };
  executed?: { chain?: string; transactionHash?: string };
  status?: string; // e.g. "called", "confirmed", "approved", "executed"
}

interface AxelarSearchResponse {
  data?: AxelarGmpRecord[];
  total?: number;
}

const nameToSlug: Record<string, ChainSlug> = Object.fromEntries(
  Object.entries(AXELAR_CHAIN_NAME).map(([slug, name]) => [name.toLowerCase(), slug as ChainSlug]),
);

export const axelarAdapter: BridgeAdapter = {
  name: "axelar",
  supportsChain(chain) {
    return chain in AXELAR_CHAIN_NAME;
  },
  async resolve({ chain, txHash }: ResolveInput): Promise<Hop | null> {
    if (!(chain in AXELAR_CHAIN_NAME)) return null;

    let data: AxelarSearchResponse;
    try {
      data = await fetchJson<AxelarSearchResponse>(
        "https://api.axelarscan.io/gmp/searchGMP",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash }),
        },
      );
    } catch {
      return null;
    }

    const record = data.data?.[0];
    if (!record?.call) return null;
    if (record.call.transactionHash?.toLowerCase() !== txHash.toLowerCase()) return null;

    const destChainName =
      record.executed?.chain ?? record.call.returnValues?.destinationChain;
    const destChain = destChainName ? nameToSlug[destChainName.toLowerCase()] : undefined;
    const destTx = record.executed?.transactionHash;

    return {
      bridge: "axelar",
      sourceChain: chain,
      sourceTx: txHash,
      sourceAddress: record.call.returnValues?.sender,
      destChain,
      destTx,
      destAddress: record.call.returnValues?.destinationContractAddress,
      amount: record.call.returnValues?.amount,
      token: record.call.returnValues?.symbol,
      confidence: destTx ? "confirmed" : "unresolved",
      raw: record,
    };
  },
};

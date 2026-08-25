import type { ChainSlug } from "./types.js";

export const CHAIN_SLUGS: ChainSlug[] = [
  "ethereum",
  "arbitrum",
  "optimism",
  "base",
  "polygon",
  "bsc",
  "avalanche",
  "solana",
];

/** EVM chain IDs (also what Etherscan V2's `chainid` param expects). */
export const EVM_CHAIN_ID: Partial<Record<ChainSlug, number>> = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  polygon: 137,
  bsc: 56,
  avalanche: 43114,
};

/** LI.FI uses plain EVM chain IDs too, plus 1151111081099710 for Solana. */
export const LIFI_CHAIN_ID: Record<ChainSlug, number> = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  polygon: 137,
  bsc: 56,
  avalanche: 43114,
  solana: 1151111081099710,
};

/**
 * Wormhole's own chain ID numbering (NOT EVM chain IDs). See
 * https://wormhole.com/docs/build/reference/chain-ids/ — verify before
 * relying on this for anything beyond investigative triage, Wormhole adds
 * chains over time.
 */
export const WORMHOLE_CHAIN_ID: Partial<Record<ChainSlug, number>> = {
  solana: 1,
  ethereum: 2,
  bsc: 4,
  polygon: 5,
  avalanche: 6,
  optimism: 24,
  base: 30,
  arbitrum: 23,
};

/** Axelar identifies chains by lowercase name strings, not numeric IDs. */
export const AXELAR_CHAIN_NAME: Partial<Record<ChainSlug, string>> = {
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  optimism: "optimism",
  base: "base",
  polygon: "polygon",
  bsc: "binance",
  avalanche: "avalanche",
};

export function isEvm(chain: ChainSlug): boolean {
  return chain !== "solana";
}

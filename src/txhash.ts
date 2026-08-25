import type { ChainSlug } from "./types.js";

/**
 * Compares two tx-hash-like identifiers the way each chain actually compares
 * them. EVM hashes are hex and case-insensitive by convention. Solana
 * signatures are base58, which is case-sensitive by design (its alphabet
 * treats 'A' and 'a' as distinct symbols) — lowercasing two different
 * base58 signatures can make them compare equal, which would silently
 * defeat an anti-spoof "does this response match what we asked about" check.
 */
export function sameTxHash(a: string | undefined, b: string | undefined, chain: ChainSlug): boolean {
  if (!a || !b) return false;
  return chain === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

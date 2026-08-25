import { fetchJson } from "../http.js";

/**
 * Solana JSON-RPC `getSignaturesForAddress`. Verified live on 2026-08-25
 * against the public mainnet-beta endpoint — response shape:
 * `{ result: [{ signature, blockTime, err, ... }] }`.
 */
export interface SolanaSignatureInfo {
  signature: string;
  blockTime: number | null;
  err: unknown;
}

interface RpcResponse<T> {
  result?: T;
  error?: { message?: string };
}

export interface SolanaLookupResult {
  /** false means the RPC call itself failed (network error, rate limit,
   * malformed response) — NOT that the address has no signatures. Callers
   * must not treat `ok: false` as a confirmed dead end. */
  ok: boolean;
  signatures: SolanaSignatureInfo[];
}

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export async function getRecentSignatures(
  address: string,
  rpcUrl: string | undefined,
  limit = 25,
): Promise<SolanaLookupResult> {
  let data: RpcResponse<SolanaSignatureInfo[]>;
  try {
    data = await fetchJson(rpcUrl || DEFAULT_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [address, { limit }],
      }),
    });
  } catch {
    return { ok: false, signatures: [] };
  }

  if (data.error || !Array.isArray(data.result)) return { ok: false, signatures: [] };
  return { ok: true, signatures: data.result };
}

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

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export async function getRecentSignatures(
  address: string,
  rpcUrl: string | undefined,
  limit = 25,
): Promise<SolanaSignatureInfo[]> {
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
    return [];
  }

  return data.result ?? [];
}

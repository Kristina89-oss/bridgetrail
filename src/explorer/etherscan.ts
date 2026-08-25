import type { ChainSlug } from "../types.js";
import { EVM_CHAIN_ID } from "../chains.js";
import { fetchJson } from "../http.js";

/**
 * Etherscan V2 unified multichain API — one key, 50+ EVM chains, selected via
 * `chainid`. V1 was deprecated 2025-08-15. Verified live on 2026-08-25: an
 * unauthenticated call returns `{"status":"0","message":"NOTOK","result":
 * "Missing/Invalid API Key"}`, confirming both the base URL and this error
 * shape; the `txlist` success shape (`status:"1"`, `result: EtherscanTx[]`)
 * follows Etherscan's long-standing, stable public documentation. A
 * genuinely empty address returns `status:"0"`, `message:"No transactions found"`
 * — distinguished below from an actual error under the same `status:"0"`.
 */
export interface EtherscanTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  blockNumber: string;
  isError: string;
  functionName?: string;
}

interface EtherscanListResponse {
  status: string;
  message: string;
  result: EtherscanTx[] | string;
}

export interface ExplorerLookupResult {
  /** false means the lookup itself failed (network error, rate limit, bad
   * key, unexpected response) — NOT that the address has no transactions.
   * Callers must not treat `ok: false` as a confirmed dead end. */
  ok: boolean;
  txs: EtherscanTx[];
}

/** Most recent outgoing transactions for an address on `chain`. */
export async function getRecentTransactions(
  chain: ChainSlug,
  address: string,
  apiKey: string | undefined,
  limit = 25,
): Promise<ExplorerLookupResult> {
  const chainId = EVM_CHAIN_ID[chain];
  if (!apiKey || chainId === undefined) return { ok: false, txs: [] };

  const url =
    `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=txlist` +
    `&address=${address}&sort=desc&page=1&offset=${limit}&apikey=${encodeURIComponent(apiKey)}`;

  let data: EtherscanListResponse;
  try {
    data = await fetchJson<EtherscanListResponse>(url);
  } catch {
    return { ok: false, txs: [] };
  }

  if (data.status === "1" && Array.isArray(data.result)) {
    return { ok: true, txs: data.result };
  }
  if (data.status === "0" && data.message === "No transactions found") {
    return { ok: true, txs: [] };
  }
  return { ok: false, txs: [] };
}

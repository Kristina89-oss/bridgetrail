import type { ChainSlug } from "../types.js";
import { EVM_CHAIN_ID } from "../chains.js";
import { fetchJson } from "../http.js";

/**
 * Etherscan V2 unified multichain API — one key, 50+ EVM chains, selected via
 * `chainid`. V1 was deprecated 2025-08-15. Verified live on 2026-08-25: an
 * unauthenticated call returns `{"status":"0","message":"NOTOK","result":
 * "Missing/Invalid API Key"}`, confirming both the base URL and this error
 * shape; the `txlist` success shape (`status:"1"`, `result: EtherscanTx[]`)
 * follows Etherscan's long-standing, stable public documentation.
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

/**
 * Most recent outgoing transactions for an address on `chain`. Returns []
 * if no API key is configured, rather than throwing — callers should treat
 * that as "can't continue the trace here", not "dead end confirmed".
 */
export async function getRecentTransactions(
  chain: ChainSlug,
  address: string,
  apiKey: string | undefined,
  limit = 25,
): Promise<EtherscanTx[]> {
  const chainId = EVM_CHAIN_ID[chain];
  if (!apiKey || chainId === undefined) return [];

  const url =
    `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=txlist` +
    `&address=${address}&sort=desc&page=1&offset=${limit}&apikey=${encodeURIComponent(apiKey)}`;

  let data: EtherscanListResponse;
  try {
    data = await fetchJson<EtherscanListResponse>(url);
  } catch {
    return [];
  }

  if (data.status !== "1" || !Array.isArray(data.result)) return [];
  return data.result;
}

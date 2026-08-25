import { describe, it, expect, vi, afterEach } from "vitest";
import { lifiAdapter } from "../src/adapters/lifi.js";

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      text: async () => JSON.stringify(body),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("lifiAdapter", () => {
  it("resolves a DONE transfer that echoes the requested tx hash", async () => {
    const txHash = "0xabc";
    mockFetchOnce({
      status: "DONE",
      substatus: "COMPLETED",
      tool: "stargateV2Bus",
      sending: { txHash, chainId: 42161, amount: "100" },
      receiving: { txHash: "0xdef", chainId: 8453, amount: "99", token: { symbol: "USDC" } },
      fromAddress: "0x1",
      toAddress: "0x2",
    });

    const hop = await lifiAdapter.resolve({ chain: "arbitrum", txHash });
    expect(hop).not.toBeNull();
    expect(hop?.bridge).toBe("lifi:stargateV2Bus");
    expect(hop?.destChain).toBe("base");
    expect(hop?.destTx).toBe("0xdef");
    expect(hop?.confidence).toBe("confirmed");
  });

  it("discards a result whose txHash doesn't match the request (observed live drift)", async () => {
    mockFetchOnce({
      status: "DONE",
      sending: { txHash: "0x_totally_different", chainId: 42161 },
      receiving: { txHash: "0xdef", chainId: 8453 },
    });

    const hop = await lifiAdapter.resolve({ chain: "arbitrum", txHash: "0xabc" });
    expect(hop).toBeNull();
  });

  it("returns null for NOT_FOUND", async () => {
    mockFetchOnce({ status: "NOT_FOUND" });
    const hop = await lifiAdapter.resolve({ chain: "ethereum", txHash: "0xabc" });
    expect(hop).toBeNull();
  });

  it("marks a PENDING transfer as unresolved rather than confirmed", async () => {
    const txHash = "0xabc";
    mockFetchOnce({
      status: "PENDING",
      tool: "across",
      sending: { txHash, chainId: 1 },
      receiving: { chainId: 8453 },
      fromAddress: "0x1",
      toAddress: "0x2",
    });

    const hop = await lifiAdapter.resolve({ chain: "ethereum", txHash });
    expect(hop).not.toBeNull();
    expect(hop?.confidence).toBe("unresolved");
    expect(hop?.destTx).toBeUndefined();
  });
});

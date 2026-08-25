import { describe, it, expect, vi, afterEach } from "vitest";
import { wormholeAdapter } from "../src/adapters/wormhole.js";

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("wormholeAdapter", () => {
  it("returns null on an empty operations array (live-verified shape)", async () => {
    mockFetchOnce({ operations: [] });
    const hop = await wormholeAdapter.resolve({ chain: "ethereum", txHash: "0xabc" });
    expect(hop).toBeNull();
  });

  it("marks unresolved when only standarizedProperties.toChain is known (no targetChain yet)", async () => {
    mockFetchOnce({
      operations: [
        {
          sourceChain: { chainId: 1, transaction: { txHash: "0xabc" } },
          content: {
            standarizedProperties: {
              fromChain: 1,
              toChain: 30, // base
              fromAddress: "0x1",
              toAddress: "0x2",
              amount: "1000",
            },
          },
        },
      ],
    });

    const hop = await wormholeAdapter.resolve({ chain: "ethereum", txHash: "0xabc" });
    expect(hop).not.toBeNull();
    expect(hop?.destChain).toBe("base");
    expect(hop?.confidence).toBe("unresolved");
    expect(hop?.destTx).toBeUndefined();
  });

  it("marks confirmed once targetChain.transaction.txHash is present", async () => {
    mockFetchOnce({
      operations: [
        {
          sourceChain: { chainId: 1, transaction: { txHash: "0xabc" } },
          targetChain: { chainId: 30, transaction: { txHash: "0xdef" } },
          content: {
            standarizedProperties: { fromChain: 1, toChain: 30, amount: "1000" },
          },
        },
      ],
    });

    const hop = await wormholeAdapter.resolve({ chain: "ethereum", txHash: "0xabc" });
    expect(hop?.confidence).toBe("confirmed");
    expect(hop?.destTx).toBe("0xdef");
  });

  it("returns null when the input tx only matches the destination leg (regression, same class as the LI.FI bug)", async () => {
    mockFetchOnce({
      operations: [
        {
          sourceChain: { chainId: 1, transaction: { txHash: "0xabc" } },
          targetChain: { chainId: 30, transaction: { txHash: "0xdef" } },
          content: { standarizedProperties: { fromChain: 1, toChain: 30 } },
        },
      ],
    });

    // Querying with the *destination* tx hash should not be treated as a new
    // outbound hop starting there.
    const hop = await wormholeAdapter.resolve({ chain: "base", txHash: "0xdef" });
    expect(hop).toBeNull();
  });
});

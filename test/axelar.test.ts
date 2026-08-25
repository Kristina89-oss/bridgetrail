import { describe, it, expect, vi, afterEach } from "vitest";
import { axelarAdapter } from "../src/adapters/axelar.js";

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("axelarAdapter", () => {
  it("returns null when searchGMP has no matches", async () => {
    mockFetchOnce({ data: [], total: 0 });
    const hop = await axelarAdapter.resolve({ chain: "ethereum", txHash: "0xabc" });
    expect(hop).toBeNull();
  });

  it("parses a real 'executed' record shape (captured live 2026-08-25)", async () => {
    mockFetchOnce({
      data: [
        {
          call: {
            chain: "immutable",
            transactionHash: "0x477af1",
            returnValues: {
              sender: "0x4f49B53928A71E553bB1B0F66a5BcB54Fd4E8932",
              destinationChain: "Ethereum",
              destinationContractAddress: "0x4f49B53928A71E553bB1B0F66a5BcB54Fd4E8932",
            },
          },
          executed: { chain: "ethereum", transactionHash: "0x531301" },
          status: "executed",
        },
      ],
      total: 1,
    });

    const hop = await axelarAdapter.resolve({ chain: "ethereum", txHash: "0x477af1" });
    expect(hop).not.toBeNull();
    expect(hop?.destChain).toBe("ethereum");
    expect(hop?.destTx).toBe("0x531301");
    expect(hop?.confidence).toBe("confirmed");
  });

  it("falls back to call.returnValues.destinationChain (case-insensitive) before execution", async () => {
    mockFetchOnce({
      data: [
        {
          call: {
            chain: "ethereum",
            transactionHash: "0xabc",
            returnValues: { sender: "0x1", destinationChain: "Avalanche" },
          },
          status: "called",
        },
      ],
      total: 1,
    });

    const hop = await axelarAdapter.resolve({ chain: "ethereum", txHash: "0xabc" });
    expect(hop?.destChain).toBe("avalanche");
    expect(hop?.confidence).toBe("unresolved");
  });

  it("returns null when the input tx only matches the executed leg (regression, same class as the LI.FI bug)", async () => {
    mockFetchOnce({
      data: [
        {
          call: { chain: "ethereum", transactionHash: "0x477af1", returnValues: {} },
          executed: { chain: "avalanche", transactionHash: "0x531301" },
          status: "executed",
        },
      ],
      total: 1,
    });

    const hop = await axelarAdapter.resolve({ chain: "avalanche", txHash: "0x531301" });
    expect(hop).toBeNull();
  });
});

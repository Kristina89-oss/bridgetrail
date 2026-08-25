import { describe, it, expect, vi, afterEach } from "vitest";
import { celerAdapter } from "../src/adapters/celer.js";

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("celerAdapter", () => {
  it("returns null for 'transfer not found' (live-verified shape)", async () => {
    mockFetchOnce({ err: { code: 500, msg: "transfer not found" }, status: 0 });
    const hop = await celerAdapter.resolve({ chain: "ethereum", txHash: "0xabc" });
    expect(hop).toBeNull();
  });

  it("infers destChain from the explorer link and marks confirmed when status is COMPLETED", async () => {
    mockFetchOnce({
      status: 5, // TRANSFER_COMPLETED
      dst_block_tx_link:
        "https://bscscan.com/tx/0xdb3216878687ab83cd6f8bd263222ec5c1358c4aec21213e2ea784bcb2732f86",
    });
    const hop = await celerAdapter.resolve({ chain: "ethereum", txHash: "0xabc" });
    expect(hop).not.toBeNull();
    expect(hop?.destChain).toBe("bsc");
    expect(hop?.destTx).toBe(
      "0xdb3216878687ab83cd6f8bd263222ec5c1358c4aec21213e2ea784bcb2732f86",
    );
    expect(hop?.confidence).toBe("confirmed");
  });

  it("marks unresolved when status isn't COMPLETED yet", async () => {
    mockFetchOnce({ status: 3 }); // WAITING_FOR_SGN_CONFIRMATION
    const hop = await celerAdapter.resolve({ chain: "ethereum", txHash: "0xabc" });
    expect(hop).not.toBeNull();
    expect(hop?.confidence).toBe("unresolved");
    expect(hop?.destTx).toBeUndefined();
  });
});

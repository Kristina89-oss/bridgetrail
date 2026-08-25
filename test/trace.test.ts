import { describe, it, expect, vi, afterEach } from "vitest";
import { trace } from "../src/trace.js";
import type { BridgeAdapter, Hop } from "../src/types.js";

afterEach(() => vi.unstubAllGlobals());

function fakeAdapter(hops: Record<string, Hop | null>): BridgeAdapter {
  return {
    name: "fake",
    supportsChain: () => true,
    resolve: async ({ chain, txHash }) => hops[`${chain}:${txHash}`] ?? null,
  };
}

describe("trace", () => {
  it("follows a chain of confirmed hops with dest tx hashes", async () => {
    const adapter = fakeAdapter({
      "ethereum:tx1": {
        bridge: "fake",
        sourceChain: "ethereum",
        sourceTx: "tx1",
        destChain: "arbitrum",
        destTx: "tx2",
        confidence: "confirmed",
      },
      "arbitrum:tx2": {
        bridge: "fake",
        sourceChain: "arbitrum",
        sourceTx: "tx2",
        confidence: "unresolved", // dead end, e.g. funds stayed put
      },
    });

    const result = await trace([adapter], "ethereum", "tx1");
    // Both hops are recorded: the confirmed ethereum->arbitrum hop, and the
    // unresolved one found (but not followed further) on arbitrum.
    expect(result.hops).toHaveLength(2);
    expect(result.root.children[0].chain).toBe("arbitrum");
    expect(result.root.children[0].tx).toBe("tx2");
    expect(result.root.children[0].children).toHaveLength(0);
    // The unresolved hop found on arbitrum:tx2 must be visible in the node
    // itself, not just recoverable by cross-referencing the flat hops[]
    // array — otherwise it's indistinguishable from a node nobody examined.
    expect(result.root.children[0].stopReason).toBe("unresolved-hop");
  });

  it("stops at max-hops even if more hops are resolvable", async () => {
    const adapter: BridgeAdapter = {
      name: "infinite",
      supportsChain: () => true,
      resolve: async ({ txHash }) => ({
        bridge: "infinite",
        sourceChain: "ethereum",
        sourceTx: txHash,
        destChain: "ethereum",
        destTx: txHash + "x",
        confidence: "confirmed",
      }),
    };

    const result = await trace([adapter], "ethereum", "tx", { maxHops: 2 });
    // depth 0 -> resolves hop to tx+"x" (child at depth 1)
    // depth 1 -> resolves hop to tx+"xx" (child at depth 2, hits max-hops, stops before resolving)
    expect(result.hops).toHaveLength(2);
  });

  it("marks a leaf with no adapter match as no-bridge-match", async () => {
    const adapter = fakeAdapter({});
    const result = await trace([adapter], "ethereum", "tx1");
    expect(result.hops).toHaveLength(0);
    expect(result.root.stopReason).toBe("no-bridge-match");
  });

  it("does not loop forever on a hop that points back to itself", async () => {
    const adapter: BridgeAdapter = {
      name: "cyclic",
      supportsChain: () => true,
      resolve: async ({ chain, txHash }) => ({
        bridge: "cyclic",
        sourceChain: chain,
        sourceTx: txHash,
        destChain: chain,
        destTx: txHash, // points back to the same node
        confidence: "confirmed",
      }),
    };

    const result = await trace([adapter], "ethereum", "tx1", { maxHops: 10 });
    // Should terminate (not hang) and record the cycle.
    const child = result.root.children[0];
    expect(child.stopReason).toBe("cycle");
  });

  it("does not mislabel two independent branches converging on the same tx as a cycle", async () => {
    // root -> destAddress "A" (no destTx) -> fan-out finds candidates c1, c2
    // -> both independently resolve to a hop landing on the SAME chain:tx.
    // That's convergence, not a loop back to an ancestor of either branch.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "1",
            message: "OK",
            result: [
              { hash: "c1", from: "a", to: "x", value: "0", timeStamp: "0", blockNumber: "0", isError: "0" },
              { hash: "c2", from: "a", to: "x", value: "0", timeStamp: "0", blockNumber: "0", isError: "0" },
            ],
          }),
      })),
    );

    const adapter = fakeAdapter({
      "ethereum:tx1": {
        bridge: "fake",
        sourceChain: "ethereum",
        sourceTx: "tx1",
        destChain: "arbitrum",
        destAddress: "0xA",
        confidence: "confirmed",
      },
      "arbitrum:c1": {
        bridge: "fake",
        sourceChain: "arbitrum",
        sourceTx: "c1",
        destChain: "polygon",
        destTx: "converged",
        confidence: "confirmed",
      },
      "arbitrum:c2": {
        bridge: "fake",
        sourceChain: "arbitrum",
        sourceTx: "c2",
        destChain: "polygon",
        destTx: "converged",
        confidence: "confirmed",
      },
      "polygon:converged": {
        bridge: "fake",
        sourceChain: "polygon",
        sourceTx: "converged",
        confidence: "unresolved",
      },
    });

    const result = await trace([adapter], "ethereum", "tx1", { etherscanApiKey: "key" });
    const [c1Node, c2Node] = result.root.children;
    expect(c1Node.tx).toBe("c1");
    expect(c2Node.tx).toBe("c2");
    // Both branches reach polygon:converged and should expand it normally —
    // neither is a real cycle, so neither should be stamped "cycle".
    expect(c1Node.children[0].stopReason).not.toBe("cycle");
    expect(c2Node.children[0].stopReason).not.toBe("cycle");
    expect(c1Node.children[0].stopReason).toBe("unresolved-hop");
    expect(c2Node.children[0].stopReason).toBe("unresolved-hop");
  });

  it("falls back to the default hop limit instead of disabling it when maxHops is not a finite number", async () => {
    const adapter: BridgeAdapter = {
      name: "infinite",
      supportsChain: () => true,
      resolve: async ({ txHash }) => ({
        bridge: "infinite",
        sourceChain: "ethereum",
        sourceTx: txHash,
        destChain: "ethereum",
        destTx: txHash + "x",
        confidence: "confirmed",
      }),
    };

    // NaN must NOT disable the depth guard (depth >= NaN is always false in
    // JS) — it should fall back to the documented default of 5.
    const result = await trace([adapter], "ethereum", "tx", { maxHops: NaN });
    expect(result.hops).toHaveLength(5);
  });

  it("distinguishes an explorer lookup failure from a confirmed empty result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: "0", message: "NOTOK", result: "Max rate limit reached" }),
      })),
    );

    const adapter = fakeAdapter({
      "ethereum:tx1": {
        bridge: "fake",
        sourceChain: "ethereum",
        sourceTx: "tx1",
        destChain: "arbitrum",
        destAddress: "0xA",
        confidence: "confirmed",
      },
    });

    const result = await trace([adapter], "ethereum", "tx1", { etherscanApiKey: "key" });
    expect(result.root.children[0].stopReason).toBe("explorer-lookup-failed");
    expect(result.warnings.some((w) => w.includes("could not check"))).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { trace } from "../src/trace.js";
import type { BridgeAdapter, Hop } from "../src/types.js";

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
});

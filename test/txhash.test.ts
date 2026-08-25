import { describe, it, expect } from "vitest";
import { sameTxHash } from "../src/txhash.js";

describe("sameTxHash", () => {
  it("compares EVM hashes case-insensitively", () => {
    expect(sameTxHash("0xABC", "0xabc", "ethereum")).toBe(true);
  });

  it("compares Solana signatures case-sensitively (base58 is case-sensitive)", () => {
    expect(sameTxHash("AbCdEf", "abcdef", "solana")).toBe(false);
    expect(sameTxHash("AbCdEf", "AbCdEf", "solana")).toBe(true);
  });

  it("returns false when either side is missing", () => {
    expect(sameTxHash(undefined, "0xabc", "ethereum")).toBe(false);
    expect(sameTxHash("0xabc", undefined, "ethereum")).toBe(false);
  });
});

import type { BridgeAdapter } from "../types.js";
import { lifiAdapter } from "./lifi.js";
import { wormholeAdapter } from "./wormhole.js";
import { axelarAdapter } from "./axelar.js";
import { layerzeroAdapter } from "./layerzero.js";
import { debridgeAdapter } from "./debridge.js";

/**
 * Tried in order for each hop; first adapter to return a non-null Hop wins.
 * LI.FI goes first since it's an aggregator that already covers several of
 * the others (Across, Stargate, Hop, cBridge, Synapse) for routes it handled
 * — cheaper than asking every protocol-native API individually.
 */
export const defaultAdapters: BridgeAdapter[] = [
  lifiAdapter,
  wormholeAdapter,
  axelarAdapter,
  layerzeroAdapter,
  debridgeAdapter,
];

export { lifiAdapter, wormholeAdapter, axelarAdapter, layerzeroAdapter, debridgeAdapter };

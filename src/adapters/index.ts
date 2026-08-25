import type { BridgeAdapter } from "../types.js";
import { lifiAdapter } from "./lifi.js";
import { wormholeAdapter } from "./wormhole.js";
import { axelarAdapter } from "./axelar.js";
import { layerzeroAdapter } from "./layerzero.js";
import { debridgeAdapter } from "./debridge.js";
import { celerAdapter } from "./celer.js";

/**
 * Tried in order for each hop; first adapter to return a non-null Hop wins.
 * LI.FI goes first since it's an aggregator that already covers several of
 * the others (Across, Stargate, Hop, cBridge, Synapse) for routes it handled
 * — cheaper than asking every protocol-native API individually. Celer goes
 * last: its adapter relies on an undocumented convenience path with an
 * unverified populated-response shape (see celer.ts), so LI.FI's own cBridge
 * coverage should win when both would otherwise match.
 */
export const defaultAdapters: BridgeAdapter[] = [
  lifiAdapter,
  wormholeAdapter,
  axelarAdapter,
  layerzeroAdapter,
  debridgeAdapter,
  celerAdapter,
];

export {
  lifiAdapter,
  wormholeAdapter,
  axelarAdapter,
  layerzeroAdapter,
  debridgeAdapter,
  celerAdapter,
};

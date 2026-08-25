# bridgetrail

Recursive cross-chain bridge-hop tracer for blockchain investigators, AML/compliance
analysts, and OSINT researchers.

Give it one transaction hash. It follows the funds forward across bridges — by asking
each bridge protocol's **own public status API** "do you know this tx?" instead of
guessing from timestamps and amounts — and outputs a confidence-scored trace tree.

```bash
bridgetrail trace ethereum 0x25c70aedec098e1fd37789bba5f3bf65d0dbca7291937d14b4ac2fc167753aee
```

```json
{
  "root": {
    "chain": "ethereum",
    "tx": "0x25c7...",
    "children": [
      {
        "chain": "bsc",
        "tx": "0x12de...",
        "hop": { "bridge": "lifi:squid", "confidence": "confirmed", "destChain": "bsc", "...": "..." }
      }
    ]
  },
  "hops": ["..."],
  "warnings": []
}
```

## Why

Chain-hopping is now the defining money-laundering pattern in crypto — cross-chain
laundering volume grew roughly 5x from 2022 to 2025. The full-featured commercial
platforms that automate this (Chainalysis, Elliptic, TRM) cost $40k–200k+/year,
putting real cross-chain tracing out of reach for independent researchers,
journalists, small compliance teams, and smaller law-enforcement units. Meanwhile,
several major bridge protocols already expose free, public APIs that answer
"where did this specific transaction's funds land?" — this tool just wires those
together into one recursive trace instead of doing it by hand across half a dozen
block explorer tabs.

## How it works

For each hop, `bridgetrail` tries a list of adapters in order; the first one whose
indexer recognizes the transaction hash wins:

1. **LI.FI** (`li.quest`) — aggregator covering Across, Stargate, Hop, Squid,
   Synapse, cBridge-routed transfers, and more, via one status call.
2. **Wormhole** (Wormholescan) — native Wormhole/Portal transfers.
3. **Axelar** (Axelarscan GMP) — native Axelar General Message Passing transfers.
4. **LayerZero** (LayerZero Scan v2) — native LayerZero messages.
5. **deBridge** (DLN API) — deBridge orders (destination chain + address only;
   this API doesn't expose a destination tx hash).

If a hop resolves to a destination **transaction**, the trace recurses on it
directly. If it only resolves to a destination **address** (no tx hash — e.g.
deBridge, or a pending transfer), `bridgetrail` looks up that address's most
recent transactions (via the Etherscan v2 multichain API, or Solana RPC for
Solana) and probes each one as a possible re-bridge. If nothing matches, that's
reported as a leaf — which is itself the answer ("funds landed here and haven't
moved since").

Every hop and every node carries either a `confidence` or a `stopReason`, so
the output tells you exactly how it got each conclusion and where it gave up:

- `confidence: "confirmed"` — the bridge's own indexer confirmed a completed
  destination-side transaction.
- `confidence: "unresolved"` — a bridge match was found, but it hasn't (yet)
  resolved to a completed destination tx (pending, or the protocol doesn't
  expose one).
- `stopReason: "no-bridge-match"` — none of the adapters recognized this tx as
  a bridge transaction. Likely means funds didn't move to another chain here.
- `stopReason: "max-depth"` / `"cycle"` — recursion limits, not investigative
  findings.
- `stopReason: "no-explorer-key"` — landed on an address but couldn't check for
  a re-bridge because `ETHERSCAN_API_KEY` isn't set.

## Install

```bash
git clone <this repo>
cd bridgetrail
npm install
cp .env.example .env   # add a free Etherscan API key for multi-hop tracing
npm run build
```

## Usage

```bash
# One-off run without building:
npx tsx src/cli.ts trace <chain> <txHash>

# Or after `npm run build`:
node dist/cli.js trace <chain> <txHash>
```

```
Usage: bridgetrail trace [options] <chain> <txHash>

Options:
  -d, --max-hops <n>   maximum number of hops to follow (default: "5")
  -f, --fan-out <n>    recent txs to probe per landing address (default: "5")
  -o, --out <file>     write JSON trace to this file (default: stdout)
  -g, --graph <file>   also write a Mermaid graph to this file
```

Supported chains: `ethereum`, `arbitrum`, `optimism`, `base`, `polygon`, `bsc`,
`avalanche`, `solana`.

### As a library

```ts
import { trace, defaultAdapters, toMermaid } from "bridgetrail";

const result = await trace(defaultAdapters, "ethereum", "0x...", {
  etherscanApiKey: process.env.ETHERSCAN_API_KEY,
});
console.log(toMermaid(result.root));
```

## Known limitations — read before relying on this for evidence

- **Not exhaustive.** This covers ~5-8 major bridges/aggregators. Long-tail or
  brand-new bridges will show up as `no-bridge-match` even if funds did in fact
  cross a bridge there. A `no-bridge-match` leaf means "not recognized by the
  adapters we have," not "funds provably stayed on this chain."
- **LI.FI's `/status` endpoint does not reliably 404 on an unmatched tx hash** —
  in testing it sometimes returned an unrelated transfer's data. The LI.FI
  adapter defends against this by requiring the response to echo the requested
  tx hash, and discards it otherwise, but treat any single-source result with
  the same caution you'd apply to any one vendor's data.
- **Two data sources can legitimately disagree** on multi-step aggregator
  routes (e.g. bridge, then an on-destination swap) — a raw Axelar GMP
  "executed" tx and LI.FI's "receiving" tx for the same transfer were
  different hashes in testing, both correct for what they each measure. The
  `bridge` field on each hop names exactly which API produced it — cross-check
  when it matters.
- **Doesn't touch privacy tech.** Mixers and privacy-preserving chains
  (Tornado-Cash-style mixers, Monero) are out of scope by design; this tool
  only follows funds through bridges that publish their own routing data.
- **The LayerZero and Wormhole adapters' populated-response field mappings**
  were built from official docs/SDKs and only partially verified against live
  populated responses in this session (see comments in `src/adapters/*.ts` for
  exactly what was and wasn't confirmed live). Sanity-check unexpected results
  against the protocol's own explorer UI.
- **`ETHERSCAN_API_KEY` is required for multi-hop tracing.** Without it, the
  trace stops after the first hop that doesn't resolve directly to a
  destination tx hash.

## Contributing

The adapter list is deliberately small and meant to grow. To add a bridge:
implement the `BridgeAdapter` interface in `src/types.ts` (one method:
`resolve({chain, txHash}) -> Hop | null`, using the bridge's own public status
API — not local contract/log parsing, which breaks on every contract upgrade),
add it to `src/adapters/index.ts`, and add a test with a captured real response
shape like the existing adapter tests. PRs adding chain-ID mappings, fixing a
drifted field name, or adding a new adapter are all welcome.

## License

MIT

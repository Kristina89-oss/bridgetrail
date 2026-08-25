import type { TraceNode } from "./types.js";

function nodeLabel(node: TraceNode): string {
  const short = node.tx ? `${node.tx.slice(0, 8)}…` : "(no tx)";
  return `${node.chain}\\n${short}`;
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Renders a trace as a Mermaid flowchart (paste into https://mermaid.live or a .md file). */
export function toMermaid(root: TraceNode): string {
  const lines = ["flowchart LR"];
  let counter = 0;
  const idFor = new Map<TraceNode, string>();

  function id(node: TraceNode): string {
    if (!idFor.has(node)) idFor.set(node, `n${counter++}_${sanitizeId(node.chain)}`);
    return idFor.get(node)!;
  }

  function visit(node: TraceNode) {
    const nid = id(node);
    lines.push(`  ${nid}["${nodeLabel(node)}"]`);
    if (node.stopReason) {
      const stopId = `${nid}_stop`;
      lines.push(`  ${stopId}{{"${node.stopReason}"}}`);
      lines.push(`  ${nid} -.-> ${stopId}`);
    }
    for (const child of node.children) {
      visit(child);
      const bridgeLabel = child.hop ? child.hop.bridge : "";
      lines.push(`  ${nid} -->|${bridgeLabel}| ${id(child)}`);
    }
  }

  visit(root);
  return lines.join("\n");
}

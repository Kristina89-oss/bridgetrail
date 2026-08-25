import type { TraceNode } from "./types.js";

/** Escapes text embedded in Mermaid label syntax. Node/edge labels here can
 * come straight from external bridge APIs (e.g. LI.FI's `tool` field) with
 * no guarantee they're free of `"`, `|`, or newlines — any of which breaks
 * the generated diagram's syntax if left unescaped. */
function escapeMermaidText(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/[\r\n]+/g, " ");
}

function nodeLabel(node: TraceNode): string {
  const short = node.tx ? `${node.tx.slice(0, 8)}…` : "(no tx)";
  return escapeMermaidText(`${node.chain}\\n${short}`);
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
      lines.push(`  ${stopId}{{"${escapeMermaidText(node.stopReason)}"}}`);
      lines.push(`  ${nid} -.-> ${stopId}`);
    }
    for (const child of node.children) {
      visit(child);
      const bridgeLabel = child.hop ? escapeMermaidText(child.hop.bridge) : "";
      lines.push(`  ${nid} -->|"${bridgeLabel}"| ${id(child)}`);
    }
  }

  visit(root);
  return lines.join("\n");
}

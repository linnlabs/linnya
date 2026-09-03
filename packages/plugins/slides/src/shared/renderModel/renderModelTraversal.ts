import type { GroupRenderNode, RenderNode } from './renderModel';

export interface RenderNodeVisitContext {
  node: RenderNode;
  parent: GroupRenderNode | null;
}

export function visitRenderNodes(
  nodes: RenderNode[],
  visitor: (context: RenderNodeVisitContext) => void,
  parent: GroupRenderNode | null = null,
): void {
  for (const node of nodes) {
    visitor({ node, parent });
    if (node.kind === 'group') {
      visitRenderNodes(node.children, visitor, node);
    }
  }
}

export function flattenRenderNodes(nodes: RenderNode[]): RenderNode[] {
  const flattened: RenderNode[] = [];
  visitRenderNodes(nodes, ({ node }) => {
    flattened.push(node);
  });
  return flattened;
}

export function findRenderNode(
  nodes: RenderNode[],
  predicate: (context: RenderNodeVisitContext) => boolean,
): RenderNodeVisitContext | null {
  let match: RenderNodeVisitContext | null = null;
  visitRenderNodes(nodes, (context) => {
    if (match) {
      return;
    }
    if (predicate(context)) {
      match = context;
    }
  });
  return match;
}

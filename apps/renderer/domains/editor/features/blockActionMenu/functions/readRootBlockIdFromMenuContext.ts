interface MenuContextWithRootBlockId {
  rootBlockNode: {
    attrs: Record<string, unknown>;
  };
}

export function readRootBlockIdFromMenuContext(
  context: MenuContextWithRootBlockId | null
): string | null {
  if (!context) return null;
  const blockId: unknown = context.rootBlockNode.attrs.id;
  return typeof blockId === 'string' && blockId.length > 0 ? blockId : null;
}

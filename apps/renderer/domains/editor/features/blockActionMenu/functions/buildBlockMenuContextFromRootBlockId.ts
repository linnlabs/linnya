import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { getBlockPosIndex } from '../../../extensions/position/blockPosIndex';
import type { BlockMenuContext } from '../types';

export type BlockMenuContextResolveFailureReason =
  | 'missing-block-id'
  | 'block-not-found'
  | 'not-root-block'
  | 'missing-content-block';

export interface BlockMenuContextEditor {
  state: {
    doc: ProseMirrorNode;
  };
}

export interface BuildBlockMenuContextFromRootBlockIdInput<TEditor extends BlockMenuContextEditor> {
  editor: TEditor;
  rootBlockId: string | null | undefined;
  hasAnnotations?: boolean;
}

export interface BlockMenuContextParts {
  rootBlockNode: ProseMirrorNode;
  rootBlockPos: number;
  contentBlockType: string;
  contentBlockNode: ProseMirrorNode;
  contentBlockPos: number;
}

export type BlockMenuContextForEditor<TEditor extends BlockMenuContextEditor> =
  Omit<BlockMenuContext, 'editor'> & {
    editor: TEditor;
  };

export type ResolveBlockMenuContextPartsResult =
  | {
    ok: true;
    parts: BlockMenuContextParts;
  }
  | {
    ok: false;
    reason: BlockMenuContextResolveFailureReason;
    rootBlockId?: string;
    rootBlockPos?: number;
    nodeType?: string;
  };

export type BuildBlockMenuContextFromRootBlockIdResult<TEditor extends BlockMenuContextEditor> =
  | {
    ok: true;
    context: BlockMenuContextForEditor<TEditor>;
  }
  | {
    ok: false;
    reason: BlockMenuContextResolveFailureReason;
    rootBlockId?: string;
    rootBlockPos?: number;
    nodeType?: string;
  };

/**
 * 按 rootBlockId 从最新 ProseMirror doc 里读取菜单上下文所需节点信息。
 *
 * 中文说明：BlockChromeHost 不持有 NodeView 的 `node/getPos`，
 * 所以菜单上下文必须以稳定的 blockId 为入口，并通过 doc 级索引读取最新位置。
 */
export function resolveBlockMenuContextPartsFromRootBlockId(
  doc: ProseMirrorNode,
  rootBlockId: string | null | undefined
): ResolveBlockMenuContextPartsResult {
  if (!rootBlockId) {
    return {
      ok: false,
      reason: 'missing-block-id',
    };
  }

  const rootBlockPos = getBlockPosIndex(doc).get(rootBlockId);
  if (typeof rootBlockPos !== 'number') {
    return {
      ok: false,
      reason: 'block-not-found',
      rootBlockId,
    };
  }

  const rootBlockNode = doc.nodeAt(rootBlockPos);
  if (!rootBlockNode) {
    return {
      ok: false,
      reason: 'block-not-found',
      rootBlockId,
      rootBlockPos,
    };
  }

  if (rootBlockNode.type.name !== 'rootBlock') {
    return {
      ok: false,
      reason: 'not-root-block',
      rootBlockId,
      rootBlockPos,
      nodeType: rootBlockNode.type.name,
    };
  }

  const contentBlockNode = rootBlockNode.firstChild;
  if (!contentBlockNode) {
    return {
      ok: false,
      reason: 'missing-content-block',
      rootBlockId,
      rootBlockPos,
      nodeType: rootBlockNode.type.name,
    };
  }

  return {
    ok: true,
    parts: {
      rootBlockNode,
      rootBlockPos,
      contentBlockType: contentBlockNode.type.name,
      contentBlockNode,
      contentBlockPos: rootBlockPos + 1,
    },
  };
}

/**
 * 构造块操作菜单上下文。
 *
 * 中文说明：这里只做“从当前 doc 快照读取上下文”这件事，不打开菜单、不触发副作用。
 * 旧 BlockView 与后续 BlockChromeHost 应复用同一个入口，避免继续分叉两套菜单语义。
 */
export function buildBlockMenuContextFromRootBlockId<TEditor extends BlockMenuContextEditor>(
  input: BuildBlockMenuContextFromRootBlockIdInput<TEditor>
): BuildBlockMenuContextFromRootBlockIdResult<TEditor> {
  const resolved = resolveBlockMenuContextPartsFromRootBlockId(
    input.editor.state.doc,
    input.rootBlockId
  );

  if (!resolved.ok) {
    return resolved;
  }

  return {
    ok: true,
    context: {
      editor: input.editor,
      ...resolved.parts,
      hasAnnotations: input.hasAnnotations ?? false,
    },
  };
}

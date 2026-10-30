import { isEditableTextContent } from '@plugin/slides/shared/authoringEditing';
import type {
  SlidesManualSlideEdits,
  SlidesManualTargetEdit,
  SlidesManualTargetKind,
} from '@plugin/slides/shared';
import type { LayoutResult } from './YogaAdapter.js';
import type {
  LayoutNode,
  LayoutSlideNode,
} from './LayoutTypes.js';
import { isContainerNode } from './LayoutTypes.js';
import { FlexComposeContractError } from './FlexComposeContractError.js';

export interface SlideManualEditProjection {
  readonly slideNode: LayoutSlideNode;
  readonly editsByKey: ReadonlyMap<string, SlidesManualTargetEdit>;
}

/**
 * 内容类人工值必须在 Yoga 前进入作者树，才能继续使用正式测量和布局规则。
 * 这里只复制受影响的树路径，不修改 sandbox 产出的原对象。
 */
export function prepareSlideManualEditProjection(
  slideNode: LayoutSlideNode,
  manualEdits: SlidesManualSlideEdits | undefined,
): SlideManualEditProjection {
  if (!manualEdits) return { slideNode, editsByKey: new Map() };
  if (slideNode.slideKey !== manualEdits.slideKey) {
    throw new FlexComposeContractError(
      `人工编辑页面 \"${manualEdits.slideKey}\" 与当前 Slide 的 slideKey 不一致。`,
    );
  }

  const editsByKey = new Map(manualEdits.targets.map(edit => [edit.editKey, edit]));
  const matchedKeys = new Set<string>();
  visitLayoutNode(slideNode, node => {
    const editKey = readLayoutEditKey(node);
    if (!editKey) return;
    const edit = editsByKey.get(editKey);
    if (!edit) return;
    const nodeKind = resolveManualTargetKind(node);
    if (edit.kind !== nodeKind) {
      throw new FlexComposeContractError(
        `人工编辑目标 \"${manualEdits.slideKey}/${editKey}\" 类型为 ${edit.kind}，实际作者对象为 ${nodeKind}。`,
      );
    }
    matchedKeys.add(editKey);
  });

  const dangling = manualEdits.targets.find(edit => !matchedKeys.has(edit.editKey));
  if (dangling) {
    throw new FlexComposeContractError(
      `人工编辑目标 \"${manualEdits.slideKey}/${dangling.editKey}\" 在作者树中不存在。`,
    );
  }

  return {
    slideNode: {
      ...slideNode,
      children: applyPreLayoutManualEditsToChildren(slideNode.children, editsByKey),
    },
    editsByKey,
  };
}

/** Frame 与子对象的位移按作者树层级累加，并只作用于 Yoga 已计算出的几何。 */
export function translateManualLayoutResult(
  result: LayoutResult,
  editsByKey: ReadonlyMap<string, SlidesManualTargetEdit>,
  inherited = { dx: 0, dy: 0 },
): LayoutResult {
  const editKey = readLayoutEditKey(result.node);
  const ownEdit = editKey ? editsByKey.get(editKey) : undefined;
  const ownTranslation = ownEdit?.deleted !== true && ownEdit && 'translation' in ownEdit
    ? ownEdit.translation
    : undefined;
  const ownVisualSize = ownEdit?.deleted !== true
    && (ownEdit?.kind === 'shape' || ownEdit?.kind === 'image')
    ? ownEdit.visualSize
    : undefined;
  const translation = {
    dx: inherited.dx + (ownTranslation?.dx ?? 0),
    dy: inherited.dy + (ownTranslation?.dy ?? 0),
  };
  return {
    ...result,
    node: result.node,
    box: {
      ...result.box,
      x: result.box.x + translation.dx,
      y: result.box.y + translation.dy,
      ...(ownVisualSize
        ? { w: ownVisualSize.width, h: ownVisualSize.height }
        : {}),
    },
    children: result.children.map(child => translateManualLayoutResult(child, editsByKey, translation)),
  };
}

function applyPreLayoutManualEdits(
  node: LayoutNode,
  editsByKey: ReadonlyMap<string, SlidesManualTargetEdit>,
): LayoutNode | null {
  const editKey = readLayoutEditKey(node);
  const edit = editKey ? editsByKey.get(editKey) : undefined;
  if (edit?.deleted === true) return null;

  switch (node._type) {
    case 'View': {
      return {
        ...node,
        ...(edit?.kind === 'frame' && edit.backgroundColor
          ? { backgroundColor: edit.backgroundColor }
          : {}),
        children: applyPreLayoutManualEditsToChildren(node.children, editsByKey),
      };
    }
    case 'Text': {
      if (edit?.kind !== 'text') return node;
      if (edit.content !== undefined && !isEditableTextContent(node.content)) {
        throw new FlexComposeContractError(
          `人工编辑目标 "${node.editKey}" 包含不能手动覆盖的公式或未知正文。`,
        );
      }
      return {
        ...node,
        ...(edit.width !== undefined ? { width: edit.width, w: edit.width,
          ...(typeof node.position === 'object' ? { position: { ...node.position, w: edit.width } } : {}) } : {}),
        ...(edit.content !== undefined ? { content: edit.content } : {}),
        ...(edit.fontSizePt !== undefined ? { fontSize: edit.fontSizePt } : {}),
        ...(edit.color !== undefined ? { color: edit.color } : {}),
        ...(edit.bold !== undefined ? { bold: edit.bold, fontWeight: edit.bold ? 'bold' : 'normal' } : {}),
        ...(edit.italic !== undefined ? { italic: edit.italic, fontStyle: edit.italic ? 'italic' : 'normal' } : {}),
        ...(edit.underline !== undefined ? { underline: edit.underline, textDecoration: edit.underline ? 'underline' : 'none' } : {}),
        ...(edit.align !== undefined ? { textAlign: edit.align } : {}),
      };
    }
    case 'Shape': {
      if (edit?.kind !== 'shape') return node;
      if (edit.content !== undefined && typeof node.content !== 'string') {
        throw new FlexComposeContractError(
          `人工编辑目标 "${node.editKey}" 不是带有纯文本的形状。`,
        );
      }
      return {
        ...node,
        ...(edit.fillColor !== undefined ? { fill: edit.fillColor } : {}),
        ...(edit.content !== undefined ? { content: edit.content } : {}),
      };
    }
    case 'Image': return edit?.kind === 'image' ? { ...node, ...(edit.assetId ? { src: { kind: 'document_asset', assetId: edit.assetId } } : {}), ...(edit.fit ? { fitMode: edit.fit } : {}) } : node;
    case 'Chart':
    case 'Table':
    case 'SvgGraphic':
    case 'Formula':
    case 'Spacer':
      return node;
    case 'Slide':
      return {
        ...node,
        children: applyPreLayoutManualEditsToChildren(node.children, editsByKey),
      };
  }
}

function applyPreLayoutManualEditsToChildren(
  children: readonly LayoutNode[],
  editsByKey: ReadonlyMap<string, SlidesManualTargetEdit>,
): LayoutNode[] {
  return children.flatMap((child) => {
    const next = applyPreLayoutManualEdits(child, editsByKey);
    return next ? [next] : [];
  });
}

export function resolveManualTargetKind(node: LayoutNode): SlidesManualTargetKind {
  switch (node._type) {
    case 'View':
      return 'frame';
    case 'Text':
      return 'text';
    case 'Shape':
      return 'shape';
    case 'Image':
      return 'image';
    case 'Chart':
      return 'chart';
    case 'Table':
      return 'table';
    case 'SvgGraphic':
      return 'svgGraphic';
    case 'Formula':
      return 'formula';
    case 'Slide':
    case 'Spacer':
      throw new FlexComposeContractError(`${node._type} 不是人工编辑目标。`);
  }
}

function readLayoutEditKey(node: LayoutNode): string | undefined {
  return 'editKey' in node && typeof node.editKey === 'string' ? node.editKey : undefined;
}

function visitLayoutNode(node: LayoutNode, visit: (node: LayoutNode) => void): void {
  visit(node);
  if (!isContainerNode(node)) return;
  for (const child of node.children) visitLayoutNode(child, visit);
}

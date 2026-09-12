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
      children: slideNode.children.map(child => applyPreLayoutManualEdits(child, editsByKey)),
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
  const ownTranslation = editKey ? editsByKey.get(editKey)?.translation : undefined;
  const translation = {
    dx: inherited.dx + (ownTranslation?.dx ?? 0),
    dy: inherited.dy + (ownTranslation?.dy ?? 0),
  };
  return {
    node: result.node,
    box: {
      ...result.box,
      x: result.box.x + translation.dx,
      y: result.box.y + translation.dy,
    },
    children: result.children.map(child => translateManualLayoutResult(child, editsByKey, translation)),
  };
}

function applyPreLayoutManualEdits(
  node: LayoutNode,
  editsByKey: ReadonlyMap<string, SlidesManualTargetEdit>,
): LayoutNode {
  switch (node._type) {
    case 'View':
      return { ...node, children: node.children.map(child => applyPreLayoutManualEdits(child, editsByKey)) };
    case 'Text': {
      const edit = node.editKey ? editsByKey.get(node.editKey) : undefined;
      return edit?.kind === 'text' && edit.content !== undefined
        ? { ...node, content: edit.content }
        : node;
    }
    case 'Shape':
    case 'Chart':
    case 'Table':
    case 'Image':
    case 'SvgGraphic':
    case 'Formula':
    case 'Spacer':
      return node;
    case 'Slide':
      return {
        ...node,
        children: node.children.map(child => applyPreLayoutManualEdits(child, editsByKey)),
      };
  }
}

export function resolveManualTargetKind(node: LayoutNode): SlidesManualTargetKind {
  switch (node._type) {
    case 'View':
      return 'frame';
    case 'Text':
      return 'text';
    case 'Shape':
      return 'shape';
    case 'Chart':
      return 'chart';
    case 'Table':
      return 'table';
    case 'Image':
      return 'image';
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

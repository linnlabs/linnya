import type { Yoga } from 'yoga-layout/load';
import { computeLayoutReplay } from './computeLayoutReplay';
import type { GeneratedLayoutBox } from '@plugin/slides/shared/generatedLayoutConstraints';
import { resizeShapeTextInput } from '@plugin/slides/shared/textLayout';
import type { RenderNode, SlideRenderModel, TextRenderNode } from '../../../types/render';
import type { EditingVisualPreview } from '../definitions/editingPreviewTypes';
import { projectEditingPreviewNode } from './projectEditingPreview';
import { deriveTextPreview } from './deriveTextPreview';

/** 一次宽度编辑发布整页的完整视觉结果，命中、选区与 Canvas 消费同一份投影。 */
export function projectEditingPreviewSlide(slide: SlideRenderModel, previews: readonly EditingVisualPreview[], yoga: Yoga): ReadonlyMap<string, RenderNode> {
  const snapshot = slide.layoutReplay;
  let nodes = new Map(slide.elements.map(node => [node.id, node]));
  if (!snapshot || !previews.some(preview => preview.operation.op === 'set_text_width'
    && nodes.get(preview.elementId)?.layoutConstraintEvidence?.positionMode === 'flow')) {
    return new Map(slide.elements.map(node => [node.id, projectEditingPreviewNode(node, previews)]));
  }
  let layout = computeLayoutReplay(yoga, snapshot);
  let widths = new Map<string, number>();
  let textInputsChanged = false;
  for (const preview of previews) {
    const target = nodes.get(preview.elementId);
    const id = target?.layoutConstraintEvidence?.layoutNodeId;
    if (preview.operation.op === 'set_text_width' && target?.kind === 'text' && id && !textInputsChanged) {
      const nextWidths = new Map(widths).set(id, preview.operation.width);
      const nextLayout = computeLayoutReplay(yoga, snapshot, nextWidths);
      const projected = projectLayoutNodes(nodes, layout, nextLayout, preview);
      if (projected) { nodes = projected; layout = nextLayout; widths = nextWidths; continue; }
    }
    if (preview.operation.op === 'set_text_content' || (preview.operation.op === 'set_text_style'
      && (preview.operation.fontSizePt !== undefined || preview.operation.bold !== undefined || preview.operation.italic !== undefined))) {
      // 尚未确认的新正文/字体尚无同源布局测量，仍由原有正文预览和正式修订交接。
      textInputsChanged = true;
    }
    nodes = new Map([...nodes].map(([key, node]) => [key, projectEditingPreviewNode(node, [preview])]));
  }
  return nodes;
}

function projectLayoutNodes(nodes: ReadonlyMap<string, RenderNode>, before: ReadonlyMap<string, GeneratedLayoutBox>, after: ReadonlyMap<string, GeneratedLayoutBox>, preview: EditingVisualPreview): Map<string, RenderNode> | null {
  const result = new Map<string, RenderNode>();
  for (const [id, node] of nodes) {
    const layoutId = node.layoutConstraintEvidence?.layoutNodeId;
    const previous = layoutId ? before.get(layoutId) : undefined;
    const next = layoutId ? after.get(layoutId) : undefined;
    if (!previous || !next) { result.set(id, node); continue; }
    const anchor = id === preview.elementId ? preview.translationDelta : undefined;
    const dx = next.x - previous.x + (anchor?.dx ?? 0);
    const dy = next.y - previous.y + (anchor?.dy ?? 0);
    const dw = round(next.w) - round(previous.w), dh = round(next.h) - round(previous.h);
    if (round(dx) === 0 && round(dy) === 0 && dw === 0 && dh === 0 && id !== preview.elementId) { result.set(id, node); continue; }
    if (node.kind === 'text') {
      const prepared = node.preparedTextLayout;
      if (dw === 0 && dh === 0 && id !== preview.elementId) {
        result.set(id, { ...node, box: { ...node.box, x: round(node.box.x + dx), y: round(node.box.y + dy) },
          ...(prepared ? { preparedTextLayout: { ...prepared, inputBox: { ...prepared.inputBox, x: round(prepared.inputBox.x + dx), y: round(prepared.inputBox.y + dy) } } } : {}) });
        continue;
      }
      if (!prepared) return null;
      const input = prepared.inputBox;
      const box = { ...input, x: round(input.x + dx), y: round(input.y + dy),
        w: dw === 0 && id !== preview.elementId ? input.w : round(next.w), h: dh === 0 ? input.h : round(next.h) };
      const text = deriveTextPreview({ ...node, box, wrap: id === preview.elementId ? 'word' : node.wrap,
        preparedTextLayout: { ...prepared, inputBox: box } });
      if (!text) return null;
      result.set(id, text);
    } else {
      if ((dw !== 0 || dh !== 0) && node.kind !== 'shape') return null;
      const box = { ...node.box, x: round(node.box.x + dx), y: round(node.box.y + dy), w: round(node.box.w + dw), h: round(node.box.h + dh) };
      let innerText: TextRenderNode | undefined;
      if (node.kind === 'shape' && node.innerText) {
        const input = node.innerText.preparedTextLayout?.inputBox ?? node.innerText.box;
        const moved = { ...input, x: round(input.x + dx), y: round(input.y + dy), w: round(input.w + dw), h: round(input.h + dh) };
        innerText = dw === 0 && dh === 0 ? { ...node.innerText, box: { ...node.innerText.box, x: round(node.innerText.box.x + dx), y: round(node.innerText.box.y + dy) },
          ...(node.innerText.preparedTextLayout ? { preparedTextLayout: { ...node.innerText.preparedTextLayout, inputBox: moved } } : {}) }
          : deriveTextPreview(resizeShapeTextInput(node.innerText, moved)) ?? undefined;
        if (!innerText) return null;
      }
      result.set(id, { ...node, box, ...(innerText ? { innerText } : {}) });
    }
  }
  return result;
}
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }

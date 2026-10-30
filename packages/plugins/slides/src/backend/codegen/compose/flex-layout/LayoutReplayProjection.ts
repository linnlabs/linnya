import type { LayoutReplay, LayoutReplayMeasurement } from '@plugin/slides/shared/generatedLayoutReplay';
import type { LayoutNode } from './LayoutTypes';
import type { LayoutResult } from './YogaAdapter';
import { measureIntrinsicTextBox, readGeneratedTextHeightMeasurement } from './TextMeasurer';
import { resolveLayoutTextWrapPolicy } from './TextBoxSizing';

export function readLayoutReplayMeasurement(node: LayoutNode): LayoutReplayMeasurement | undefined {
  if (node._type !== 'Text') return undefined;
  const measurement = readGeneratedTextHeightMeasurement(node);
  if (!measurement) return undefined;
  return { kind: 'text', content: typeof node.content === 'string' ? node.content : (node.content ?? []).map(run => 'text' in run ? run.text : '').join(''),
    fontSizePt: measurement.fontSizePt, lineSpacingMultiple: measurement.lineSpacingMultiple,
    letterSpacingPt: measurement.letterSpacingPt, intrinsicWidth: measureIntrinsicTextBox(node).widthInches,
    wrap: resolveLayoutTextWrapPolicy(node) === 'none' ? 'none' : 'word', explicitHeight: (node.height ?? node.h) !== undefined };
}

/** 身份按最终绘制树与 evidence 对齐；兄弟的布局次序另存，不被“置于顶层”改写。 */
export function buildLayoutReplay(result: LayoutResult, slideNumber: number): LayoutReplay | undefined {
  // 空白页无须交互重排。独立测量 owner 不能用上次结果冒充 measureFunc，整页留给正式编译。
  if (result.children.length === 0 || !canReplay(result)) return undefined;
  const nodes: LayoutReplay['nodes'] = [];
  function visit(current: LayoutResult, parent: number, path: string): void {
    if (!current.replay) throw new Error('Compiler layout replay facts are missing');
    const index = nodes.length;
    nodes.push({ id: `layout:s${slideNumber}:${path}`, parent, ...current.replay });
    current.children.forEach((child, childIndex) => visit(child, index, `${path}.${childIndex}`));
  }
  visit(result, -1, 'root');
  return { nodes };
}

function canReplay(result: LayoutResult): boolean {
  if (result.node._type === 'Table' || (result.node._type === 'Text' && !result.replay?.measurement)) return false;
  return result.children.every(canReplay);
}

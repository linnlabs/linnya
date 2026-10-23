/// <reference lib="es2022.intl" />
import DiffMatchPatch from 'diff-match-patch';
import { Fragment, type Mark, type Node } from 'prosemirror-model';
import { alignUnchangedBlocks } from '../../../shared/functions/alignUnchangedBlocks';

const PRESENTATION_MARKS = new Set(['textColor', 'textHighlight']);
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function isDeleted(node: Node): boolean {
  return node.marks.some(mark => mark.type.name === 'revisionMark' && mark.attrs.changeType === 'delete');
}

function presentation(node: Node): readonly Mark[] {
  return node.marks.filter(mark => PRESENTATION_MARKS.has(mark.type.name));
}

/** 原子节点按稳定载荷对齐，导入时重新生成的节点 ID 不属于文字身份。 */
function inlineText(node: Node): string {
  if (isDeleted(node)) return '';
  if (node.isText) return node.text ?? '';
  if (node.type.name === 'hardBreak') return '\n';
  const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key !== 'id' && key !== 'citationId'));
  return `\uFFFC${JSON.stringify([node.type.name, attrs])}\uFFFC`;
}

function inlineUnits(node: Node): string[] {
  const text = inlineText(node);
  if (!text) return [];
  return node.isText ? Array.from(text) : [text];
}

function textOf(block: Node): string {
  let text = '';
  block.forEach(child => { text += inlineText(child); });
  return text;
}

function collectTextBlocks(root: Node): Node[] {
  const result: Node[] = [];
  root.descendants(node => {
    if (!node.isTextblock) return true;
    result.push(node);
    return false;
  });
  return result;
}

function preserveTextBlock(before: Node, after: Node): Node {
  if (before.type !== after.type) return after;
  const source = textOf(before), target = textOf(after);
  const dmp = new DiffMatchPatch();
  // 保真使用原始相等范围。为了美化 diff 合并小片段会丢掉真实未改文字，不能用于样式归属。
  // 禁止依赖计时超时产生不同端的不同结果；上层已经将工作限制在单个文本块内。
  dmp.Diff_Timeout = 0;
  const sourceAt = new Map<number, number>();
  let oldOffset = 0, newOffset = 0;
  for (const [operation, text] of dmp.diff_main(source, target, false)) {
    if (operation === 0) {
      for (let index = 0; index < text.length; index++) sourceAt.set(newOffset + index, oldOffset + index);
    }
    if (operation !== 1) oldOffset += text.length;
    if (operation !== -1) newOffset += text.length;
  }
  // Revision 的增删节点可能切开一个字素；必须基于去除删除片段后的完整文字判断，
  // 不能按单个 PM text 节点分段，否则预览中的半个 emoji 会与后端接受结果不同。
  const originalGraphemes = new Map(Array.from(graphemes.segment(source), part => [part.index, part.segment]));
  const unchangedTextOffsets = new Set<number>();
  for (const { index, segment } of graphemes.segment(target)) {
    const originalIndex = sourceAt.get(index);
    if (originalIndex === undefined || originalGraphemes.get(originalIndex) !== segment
      || sourceAt.get(index + segment.length - 1) !== originalIndex + segment.length - 1) continue;
    for (let i = 0; i < segment.length; i++) unchangedTextOffsets.add(index + i);
  }
  const originals: Array<{ node: Node; offset: number }> = [];
  let offset = 0;
  before.forEach(node => {
    for (const character of inlineUnits(node)) {
      for (let index = 0; index < character.length; index++) originals.push({ node, offset });
      offset += character.length;
    }
  });
  const children: Node[] = [];
  offset = 0;
  after.forEach(node => {
    if (isDeleted(node)) { children.push(node); return; }
    for (const character of inlineUnits(node)) {
      const matched = sourceAt.get(offset);
      const original = matched === undefined ? undefined : originals[matched];
      // 按完整字素恢复，组合音标、肤色和 ZWJ emoji 不能继承半个字符的样式。
      const wholeCharacter = matched !== undefined && source.slice(matched, matched + character.length) === character
        && original?.offset === matched
        && sourceAt.get(offset + character.length - 1) === matched + character.length - 1
        && (!node.isText || unchangedTextOffsets.has(offset));
      const sameNodeKind = original?.node.type === node.type;
      const retained = wholeCharacter && sameNodeKind && original ? presentation(original.node) : [];
      // 只有 Markdown 无法表达的呈现 mark 由旧稿决定，粗体、链接等仍由新 Markdown 决定。
      let marks = node.marks.filter(mark => !PRESENTATION_MARKS.has(mark.type.name));
      for (const mark of retained) {
        if (after.type.allowsMarkType(mark.type) && !marks.some(existing => existing.type.excludes(mark.type))) {
          marks = [...mark.addToSet(marks)];
        }
      }
      children.push(node.isText ? node.type.schema.text(character, marks) : node.mark(marks));
      offset += character.length;
    }
  });
  return after.copy(Fragment.fromArray(children));
}

/**
 * 只为同一个 rootBlock 恢复未改文字的颜色、高亮，不为新增文字或新块推断样式。
 * 表格先锚定未改的单元格，再配对间隙内的修改，避免插行后机械按坐标套用样式。
 * Renderer 的删除投影不参与新稿对齐，但保留原节点，部分拒绝时仍能恢复原样。
 */
export function preserveInlinePresentation(before: Node, after: Node): Node {
  if (!before.firstChild || before.firstChild.type !== after.firstChild?.type) return after;
  const originals = collectTextBlocks(before), proposed = collectTextBlocks(after);
  let hasPresentation = false;
  originals.forEach(block => block.forEach(node => { if (presentation(node).length > 0) hasPresentation = true; }));
  if (!hasPresentation) return after;
  const key = (node: Node) => JSON.stringify([node.type.name, textOf(node)]);
  const anchors = alignUnchangedBlocks(originals.map(key), proposed.map(key));
  const replacements = new Map<number, Node>();
  let source = 0, target = 0;
  for (const anchor of [...anchors, { source: originals.length, target: proposed.length }]) {
    while (source < anchor.source && target < anchor.target) {
      replacements.set(target, preserveTextBlock(originals[source], proposed[target]));
      source++; target++;
    }
    source = anchor.source;
    target = anchor.target;
    if (source < originals.length && target < proposed.length) {
      replacements.set(target, preserveTextBlock(originals[source], proposed[target]));
    }
    source++; target++;
  }
  let textBlockIndex = 0;
  const restore = (node: Node): Node => {
    const replacement = node.isTextblock ? replacements.get(textBlockIndex++) : undefined;
    if (replacement) return replacement;
    if (node.isLeaf) return node;
    const children: Node[] = [];
    node.forEach(child => children.push(restore(child)));
    return node.copy(Fragment.fromArray(children));
  };
  return restore(after);
}

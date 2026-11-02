import type { TextLayoutContract } from '../definitions/contract';
import type { RenderTextLine, VerticalGlyphOrientation, VerticalGlyphRun } from '../definitions/types';

/**
 * vertical-rl 复用同一断行器：行内方向是物理纵向，行堆叠方向是物理从右到左。
 * 逻辑盒的 x/width 对应物理纵向，y/height 对应列从右起的偏移与列宽。
 */
export function toVerticalLogicalContract(contract: TextLayoutContract): TextLayoutContract {
  return {
    ...contract,
    box: { ...contract.box, w: contract.box.h, h: contract.box.w },
    padding: {
      left: contract.padding.top,
      right: contract.padding.bottom,
      top: contract.padding.right,
      bottom: contract.padding.left,
    },
    // 省略号改写行尾正文，竖排字形序列无法同源更新，溢出统一按 clip 报告。
    overflow: contract.overflow === 'ellipsis' ? 'clip' : contract.overflow,
  };
}

/** 把一行内的 cluster 归并为可绘制序列：直立字逐字，旋转字符连续成段以保留字距。 */
export function buildVerticalGlyphRuns(
  clusters: readonly { readonly text: string; readonly advance: number }[],
): VerticalGlyphRun[] {
  const runs: VerticalGlyphRun[] = [];
  let offset = 0;
  for (const cluster of clusters) {
    const orientation = classifyVerticalGlyph(cluster.text);
    const previous = runs[runs.length - 1];
    if (orientation === 'rotated' && previous?.orientation === 'rotated') {
      previous.text += cluster.text;
    } else {
      runs.push({ text: cluster.text, offset: roundInches(offset), orientation });
    }
    offset += cluster.advance;
  }
  return runs;
}

const CORNER_PUNCTUATION = new Set(['，', '。', '、', '．']);
const ROTATED_FULLWIDTH_PATTERN = /^[（）〈〉《》「」『』【】〔〕〖〗〘〙〚〛｛｝［］：；｜～—–…‥]+$/u;

/** 依 UTR #50 的简化分类；PPTX 的 eaVert 由 PowerPoint 自行决定字形方向。 */
export function classifyVerticalGlyph(text: string): VerticalGlyphOrientation {
  if (CORNER_PUNCTUATION.has(text)) return 'corner';
  if (ROTATED_FULLWIDTH_PATTERN.test(text)) return 'rotated';
  const codePoint = text.codePointAt(0);
  return codePoint !== undefined && isUprightCodePoint(codePoint) ? 'upright' : 'rotated';
}

function isUprightCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x2E80 && codePoint <= 0xA4CF)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7AF)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFE30 && codePoint <= 0xFE4F)
    || (codePoint >= 0xFF00 && codePoint <= 0xFFEF)
    || codePoint >= 0x1F000;
}

export interface VerticalLineColumn {
  /** 列左边相对内容区左边的偏移，单位英寸。 */
  readonly x: number;
  readonly width: number;
}

/** 逻辑行 -> 物理列；同一份规则供 Konva 绘制和页面占位诊断使用。 */
export function resolveVerticalLineColumn(
  line: Pick<RenderTextLine, 'y' | 'height'>,
  contentWidthInches: number,
): VerticalLineColumn {
  return {
    x: roundInches(contentWidthInches - line.y - line.height),
    width: line.height,
  };
}

function roundInches(value: number): number {
  return Number(value.toFixed(6));
}

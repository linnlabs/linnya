import type { TextRenderNode } from '../../renderModel';
import { resolveShapeTextLayout } from './resolveShapeTextLayout';

/** 原有自动字号函数只产生 8–16pt 整数；只准备这些真实可达值，显式字号则仅准备自身。 */
export function shapeTextMeasurementVariants(node: TextRenderNode): readonly TextRenderNode[] {
  if (!node.shapeTextSizing || node.shapeTextSizing.fontSize !== undefined) return [node];
  return Array.from({ length: 9 }, (_, index) => withFontSize(node, index + 8));
}

export function resizeShapeTextInput(node: TextRenderNode, box: TextRenderNode['box']): TextRenderNode {
  if (!node.shapeTextSizing) return { ...node, box };
  const content = node.paragraphs.map(paragraph => paragraph.runs.map(run => 'text' in run ? run.text : '').join('')).join('\n');
  const defaults = resolveShapeTextLayout(box, content, node.shapeTextSizing, node.shapeTextSizing.rotated);
  return { ...withFontSize(node, defaults.fontSize), box, padding: defaults.paddingInches };
}

function withFontSize(node: TextRenderNode, fontSize: number): TextRenderNode {
  return { ...node, paragraphs: node.paragraphs.map(paragraph => ({ ...paragraph,
    runs: paragraph.runs.map(run => 'text' in run ? { ...run, fontSize } : run),
  })) };
}

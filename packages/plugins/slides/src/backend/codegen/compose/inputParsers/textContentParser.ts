import type { FreeformInlineRun } from '@plugin/slides/shared';
import { isMathFormulaSource, normalizeTextStyleColors } from '@plugin/slides/shared';
import { parseTextStyle } from './styleParsers';
import { isRecord } from './typeGuards';

/**
 * Compose 的正文准入。Worker 回读不能把合法数组当成缺省字段，否则成功构建会丢字。
 * 公式在 Flex 阶段已经规范化；此边界复用 canonical admission，不再解释作者 LaTeX。
 */
export function parseTextContent(
  value: unknown,
  path: string,
): { value: string | FreeformInlineRun[] | undefined } | { error: string } {
  if (value === undefined || typeof value === 'string') return { value };
  if (!Array.isArray(value)) return { error: `${path} 必须是字符串或文本/公式 run 数组。` };

  const runs: FreeformInlineRun[] = [];
  for (const [index, run] of value.entries()) {
    const runPath = `${path}[${index}]`;
    if (!isRecord(run)) return { error: `${runPath} 必须是文本或公式 run 对象。` };
    if ('formula' in run) {
      if (Object.keys(run).some(key => key !== 'formula')
        || !isMathFormulaSource(run.formula) || run.formula.display !== 'inline') {
        return { error: `${runPath}.formula 必须是规范化后的 inline 公式，不能混合文本字段。` };
      }
      runs.push({ formula: run.formula });
      continue;
    }
    if (typeof run.text !== 'string' || Object.keys(run).some(key => key !== 'text' && key !== 'style')) {
      return { error: `${runPath} 必须包含 text 字符串，局部样式放在 style 内。` };
    }
    if (run.style === undefined) {
      runs.push({ text: run.text });
      continue;
    }
    const style = parseTextStyle(run.style);
    // 复用样式字段解析；显式提供却未被接纳的字段必须报错，不能在回读时静默消失。
    if (!style || !isRecord(run.style)
      || Object.keys(run.style).some(key => !Object.keys(style).includes(key))) {
      return { error: `${runPath}.style 含未知字段或无效的文本样式值。` };
    }
    const normalized = normalizeTextStyleColors(style, `${runPath}.style`);
    if ('error' in normalized) return normalized;
    runs.push({ text: run.text, style: normalized.value });
  }
  return { value: runs };
}

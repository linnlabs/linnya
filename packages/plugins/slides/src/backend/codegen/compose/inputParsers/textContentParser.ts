import type { FreeformInlineRun } from '@plugin/slides/shared';
import { isMathFormulaSource, normalizeTextStyleColors } from '@plugin/slides/shared';
import { pushParseWarning, type ParseContext } from './parseContext';
import { parseTextStyle } from './styleParsers';
import { isRecord } from './typeGuards';

/**
 * 行距是段落属性，run 上没有对应：从 run 样式接口删除后，旧稿里残留的 `style.lineSpacing`
 * 不再参与排版与导出（此前也不参与），这里只把它从样式里拿掉并给 parse 阶段的提示，不报错。
 */
function dropLegacyRunLineSpacing(
  style: Record<string, unknown>,
  ctx: ParseContext | undefined,
): Record<string, unknown> {
  if (!('lineSpacing' in style)) return style;
  pushParseWarning(ctx?.field('style').field('lineSpacing'), {
    code: 'run_line_spacing_ignored',
    severity: 'warn',
    message: '富文本 run 的 style.lineSpacing 已忽略：行距是段落属性，run 上没有对应。',
    hint: '删除它；需要调整行距时改整个 Text 的 lineHeight（倍数）。',
  });
  return Object.fromEntries(Object.entries(style).filter(([key]) => key !== 'lineSpacing'));
}

/**
 * Compose 的正文准入。Worker 回读不能把合法数组当成缺省字段，否则成功构建会丢字。
 * 公式在 Flex 阶段已经规范化；此边界复用 canonical admission，不再解释作者 LaTeX。
 */
export function parseTextContent(
  value: unknown,
  path: string,
  ctx?: ParseContext,
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
    const authoredStyle = isRecord(run.style)
      ? dropLegacyRunLineSpacing(run.style, ctx?.index(index))
      : run.style;
    const style = parseTextStyle(authoredStyle);
    // 复用样式字段解析；显式提供却未被接纳的字段必须报错，不能在回读时静默消失。
    if (!style || !isRecord(authoredStyle)
      || Object.keys(authoredStyle).some(key => !Object.keys(style).includes(key))) {
      return { error: `${runPath}.style 含未知字段或无效的文本样式值。` };
    }
    const normalized = normalizeTextStyleColors(style, `${runPath}.style`);
    if ('error' in normalized) return normalized;
    runs.push({ text: run.text, style: normalized.value });
  }
  return { value: runs };
}

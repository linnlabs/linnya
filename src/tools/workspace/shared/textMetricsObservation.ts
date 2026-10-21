import type { TextCharacterMetrics, TextReadMetrics } from '@app/schemas';

function describeCharacters(metrics: TextCharacterMetrics): string {
  return `${metrics.characters} 字符（Unicode 码点），${metrics.han_characters} 汉字`;
}

export function appendCurrentTextMetrics(
  observation: string,
  metrics: TextCharacterMetrics | undefined
): string {
  return metrics
    ? `${observation}\n当前全文（含待确认修订）：${describeCharacters(metrics)}。`
    : observation;
}

/** 放在正文前，让通用输出截断后仍能看到本次窗口与全文的不同口径。 */
export function prependReadTextMetrics(observation: string, metrics: TextReadMetrics): string {
  return `[read_file: 本次正文窗口 ${describeCharacters(metrics.window)}；完整源文本 ${describeCharacters(metrics.full_text)}。计量不含行号、分页提示或来源附录。]\n\n${observation}`;
}

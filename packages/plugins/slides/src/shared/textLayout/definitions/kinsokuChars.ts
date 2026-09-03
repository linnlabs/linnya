/**
 * 中文/日文常见避头尾字符集合。
 *
 * 字符集合按公开 JIS X 4051 与 Unicode Line Breaking 行为整理，只记录规则事实：
 * 闭合标点、句读点、感叹问号等不能出现在行首；开启括号不能留在行尾。
 * 不做标点悬挂，避免在 M3 引入第二套行宽修正逻辑。
 */

const LINE_START_FORBIDDEN = new Set([
  '、', '。', '，', '．', '：', '；', '！', '？',
  ',', '.', ':', ';', '!', '?',
  ')', ']', '}',
  '）', '］', '｝', '〕', '〉', '》', '」', '』', '】', '〙', '〗',
  '〟', '’', '”', '｠', '»',
  '…', '‥', '％', '%', '℃', '°',
]);

const LINE_END_FORBIDDEN = new Set([
  '(', '[', '{',
  '（', '［', '｛', '〔', '〈', '《', '「', '『', '【', '〘', '〖',
  '〝', '‘', '“', '｟', '«',
]);

export function isKinsokuLineStartForbidden(cluster: string): boolean {
  return LINE_START_FORBIDDEN.has(firstCodePoint(cluster));
}

export function isKinsokuLineEndForbidden(cluster: string): boolean {
  return LINE_END_FORBIDDEN.has(firstCodePoint(cluster));
}

function firstCodePoint(value: string): string {
  return Array.from(value)[0] ?? '';
}

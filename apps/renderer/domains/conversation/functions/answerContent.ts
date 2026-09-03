/**
 * @description
 * 助手答案（final_answer）内容的“空白”判定。
 *
 * 背景（根因）：
 * - 少数模型/供应商在没有真正文本产出时，仍会吐出一个 final_answer，其内容不是空串，
 *   而是「肉眼不可见的字符」：零宽空格 \u200b、零宽连接符 \u200c/\u200d、Word Joiner \u2060、
 *   软连字符 \u00ad 等。
 * - 这些字符 `String.prototype.trim()` 不会移除，因此老的 `content.trim().length === 0`
 *   判定会漏判，导致投影器仍然生成一条 final_answer 消息，UI 渲染出一个空的
 *   `<p class="md-paragraph"></p>`，占用布局却没有任何可见内容，形成难看的空白间隔。
 *
 * 判定口径：
 * - 标准空白由正则 `\s` 覆盖（含空格/换行/制表符/不换行空格 \u00a0/BOM \ufeff 等）。
 * - 额外剔除零宽 / 不可见排版字符（\s 不含这些）。
 * - 剔除后长度为 0 视为空白答案。
 *
 * 注意（禁止过度防御）：
 * - 这里只处理“真实会发生”的不可见字符空白，不去尝试识别“仅由 markdown 语法字符构成、
 *   解析后渲染为空”的极端情况（例如整条答案只有一个 `\` 或 `[`）；那不是真实业务场景。
 */

// 零宽 / 不可见排版字符：\s 不覆盖，需要显式剔除
const INVISIBLE_CHARS_RE = /[\s\u200b\u200c\u200d\u2060\u00ad]/g;

export function isBlankAnswerContent(content: string): boolean {
  if (!content) return true;
  return content.replace(INVISIBLE_CHARS_RE, '').length === 0;
}

import katex from 'katex';
/** 空公式允许提交；其他公式与显示渲染使用相同 KaTeX 规则。 */
export function isLatexSourceValid(source: string): boolean {
  if (source.trim() === '') return true;
  try {
    katex.renderToString(source.trim(), { throwOnError: true, displayMode: true });
    return true;
  } catch {
    return false;
  }
}

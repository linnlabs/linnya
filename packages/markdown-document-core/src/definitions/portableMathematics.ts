import type { Attributes, JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken, MarkdownTokenizer } from '@tiptap/core';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import type { KatexOptions } from 'katex';

// 两条投影共用信任与错误策略；公式源文始终保留，TeX 不授予 HTML/链接执行权限。
export const markdownMathOptions: KatexOptions = { throwOnError: false, trust: false, strict: 'ignore' };
function mathMarkdown(name: 'inlineMath' | 'blockMath') {
  const block = name === 'blockMath';
  const tokenizer: MarkdownTokenizer = {
    name, level: block ? 'block' : 'inline', start: source => {
      const dollar = source.indexOf(block ? '$$' : '$'); const empty = block ? -1 : source.indexOf('[inlineMath latex="');
      return dollar < 0 ? empty : empty < 0 ? dollar : Math.min(dollar, empty);
    },
    tokenize(source) {
      const encoded = !block ? /^\[inlineMath latex="([^"\n]*)"\]/.exec(source) : null;
      if (encoded) return { type: name, raw: encoded[0], latex: decodeURIComponent(encoded[1]) };
      // 官方正则将 \\$ 当作结束符；必须把 TeX 转义作为一个 token 保留，不能截断金额公式。
      const match = (block ? /^\$\$((?:\\[\s\S]|(?!\$\$)[^\\])*)\$\$/ : /^\$(?!\$)((?:\\[^\n]|[^$\\\n])+)\$(?!\$)/).exec(source);
      return match ? { type: name, raw: match[0], latex: match[1].trim() } : undefined;
    },
  };
  return { markdownTokenizer: tokenizer,
    parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
      const latex: unknown = token.latex;
      if (typeof latex !== 'string') throw new Error('markdown_math_source_invalid');
      return helpers.createNode(name, { latex });
    },
    renderMarkdown(node: JSONContent, _helpers: MarkdownRendererHelpers) {
      const latex: unknown = node.attrs?.latex;
      if (typeof latex !== 'string') throw new Error('markdown_math_source_invalid');
      if (block) return `$$\n${latex}\n$$`;
      // 空行内公式和换行不能由 $…$ 无损表达，使用同一纯 tokenizer 的显式身份形态。
      return !latex.trim() || latex.includes('\n') ? `[inlineMath latex="${encodeURIComponent(latex)}"]` : `$${latex}$`;
    },
  };
}
export const PortableInlineMath = InlineMath.extend({
  ...mathMarkdown('inlineMath'),
  addAttributes() { const attributes: Attributes = this.parent?.() ?? {}; return { latex: { ...attributes.latex, validate: 'string' } }; },
}).configure({ katexOptions: { ...markdownMathOptions, displayMode: false } });
export const PortableBlockMath = BlockMath.extend({
  ...mathMarkdown('blockMath'),
  addAttributes() { const attributes: Attributes = this.parent?.() ?? {}; return { latex: { ...attributes.latex, validate: 'string' } }; },
}).configure({ katexOptions: { ...markdownMathOptions, displayMode: true } });

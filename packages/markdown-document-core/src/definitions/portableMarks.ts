import type { Attributes, JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers, MarkdownToken, MarkdownTokenizer } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { z } from 'zod';

const colorAttrs = z.object({ color: z.string().nullable().default(null) }).strict();
function contentTokens(token: MarkdownToken, helpers: MarkdownParseHelpers) {
  return helpers.parseInline(token.tokens ?? []);
}
function simpleMarkSyntax(name: 'subscript' | 'superscript', delimiter: '~' | '^') {
  const tokenizer: MarkdownTokenizer = {
    name, level: 'inline', start: source => source.indexOf(delimiter),
    tokenize(source, _tokens, lexer) {
      const pattern = delimiter === '~' ? /^~(?!~)((?:\\.|[^~\n])+?)~(?!~)/ : /^\^((?:\\.|[^\^\n])+?)\^/;
      const match = pattern.exec(source);
      if (!match) return undefined;
      return { type: name, raw: match[0], tokens: lexer.inlineTokens(match[1]) };
    },
  };
  return { markdownTokenizer: tokenizer,
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) => helpers.applyMark(name, contentTokens(token, helpers)),
    renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) => `${delimiter}${helpers.renderChildren(node)}${delimiter}`,
  };
}
/** 官方 shortcode 方言保留 color；不靠 HTML/DOMParser，后台和 Renderer 得到相同正文。 */
function colorMarkSyntax(name: 'highlight' | 'textStyle') {
  const tokenizer: MarkdownTokenizer = {
    name, level: 'inline', start: source => {
      const shortcode = source.indexOf(`[${name}`); const plain = name === 'highlight' ? source.indexOf('==') : -1;
      return shortcode < 0 ? plain : plain < 0 ? shortcode : Math.min(shortcode, plain);
    },
    tokenize(source, _tokens, lexer) {
      const shortcode = new RegExp(`^\\[${name}(?: color="([^"\\n]*)")?\\]([\\s\\S]*?)\\[/${name}\\]`).exec(source);
      if (shortcode) return { type: name, raw: shortcode[0], attributes: { color: shortcode[1] === undefined ? null : decodeURIComponent(shortcode[1]) }, tokens: lexer.inlineTokens(shortcode[2]) };
      const plain = name === 'highlight' ? /^==([^=]+)==/.exec(source) : null;
      return plain ? { type: name, raw: plain[0], attributes: { color: null }, tokens: lexer.inlineTokens(plain[1]) } : undefined;
    },
  };
  return { markdownTokenizer: tokenizer,
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers) => helpers.applyMark(name, contentTokens(token, helpers), colorAttrs.parse(token.attributes)),
    renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers) {
      const attrs = colorAttrs.parse(node.attrs); const content = helpers.renderChildren(node);
      if (name === 'highlight' && attrs.color === null) return `==${content}==`;
      const color = attrs.color === null ? '' : ` color="${encodeURIComponent(attrs.color)}"`;
      return `[${name}${color}]${content}[/${name}]`;
    },
  };
}

export const PortableSubscript = Subscript.extend(simpleMarkSyntax('subscript', '~'));
export const PortableSuperscript = Superscript.extend(simpleMarkSyntax('superscript', '^'));
export const PortableTextStyle = TextStyle.extend(colorMarkSyntax('textStyle'));
export const PortableColor = Color.extend({
  addGlobalAttributes() { return (this.parent?.() ?? []).map(group => ({ ...group, attributes: { ...group.attributes, color: { ...group.attributes.color, validate: 'string|null' } } })); },
});
export const PortableHighlight = Highlight.extend({
  ...colorMarkSyntax('highlight'),
  addAttributes() { const attributes: Attributes = this.parent?.() ?? {}; return { color: { ...attributes.color, validate: 'string|null' } }; },
}).configure({ multicolor: true });

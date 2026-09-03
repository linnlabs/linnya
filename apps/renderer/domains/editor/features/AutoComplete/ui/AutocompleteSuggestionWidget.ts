/**
 * @file AutocompleteSuggestionWidget.ts
 * @description 自动补全建议的 UI Widget 创建
 */

import { Decoration } from 'prosemirror-view';
import DOMPurify from 'dompurify';

import { parseMarkdown } from '@/shared/services/markdownService';

/**
 * 判断文本是否“可能包含 Markdown 语法”。
 *
 * 说明（中文）：
 * - 自动补全是高频场景，尽量避免对纯文本做不必要的 WASM 解析；
 * - 这里用非常轻量的启发式判断，命中后再异步解析为 HTML。
 */
function mayContainMarkdownSyntax(text: string): boolean {
  return /(\*\*|__|\*|_|`|~~|\[.+\]\(.+\)|^#{1,6}\s)/m.test(text);
}

/**
 * 将 Markdown 渲染出的 HTML 规范化为“适合内联占位符展示”的形式。
 *
 * 说明（中文）：
 * - `parseMarkdown(text, 'html')` 可能输出 `<p>...</p>` 等块级结构；
 * - 占位符 Widget 是一个 `<span>`，块级标签会导致布局异常；
 * - 这里把最常见的 `<p>` 外壳去掉，并把多段落拼为 `<br/>` 分隔的内联 HTML。
 */
function normalizeInlineHtml(markdownHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(markdownHtml, 'text/html');
  const { body } = doc;

  if (body.children.length === 1 && body.firstElementChild?.tagName === 'P') {
    return body.firstElementChild.innerHTML;
  }

  const parts: string[] = [];
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName === 'P') {
        const inner = el.innerHTML.trim();
        if (inner) parts.push(inner);
        continue;
      }
    }

    // 兜底：对非 <p> 的节点，直接收集其序列化 HTML
    const container = doc.createElement('div');
    container.appendChild(node.cloneNode(true));
    const html = container.innerHTML.trim();
    if (html) parts.push(html);
  }

  return parts.join('<br />');
}

/**
 * 创建自动补全建议的 Decoration Widget
 * @param pos 插入位置
 * @param text 建议文本
 * @returns Decoration.widget 实例
 */
export function createSuggestionWidget(pos: number, text: string): Decoration {
  const widget = document.createElement('span');
  widget.classList.add('autocomplete-suggestion');
  // 默认先用纯文本渲染，保证同步可见与低开销
  widget.textContent = text;
  widget.setAttribute('contentEditable', 'false'); // 不允许直接编辑 Suggestion
  widget.style.userSelect = 'none'; // 防止用户意外选中 Suggestion 文本

  // 异步解析 Markdown（若文本看起来包含语法），并进行安全清理后再渲染
  if (mayContainMarkdownSyntax(text)) {
    void (async () => {
      try {
        const result = await parseMarkdown(text, 'html');
        if (typeof result !== 'string') return;

        // 安全：清理 HTML，避免 markdown 中夹带 raw HTML 造成注入
        const sanitized = DOMPurify.sanitize(result);
        const inlineHtml = normalizeInlineHtml(sanitized);

        // Widget 可能已经被 ProseMirror 移除；此时无需更新 DOM
        if (!widget.isConnected) return;

        widget.innerHTML = inlineHtml;
      } catch (e) {
        // 解析失败时保持纯文本展示即可（不要影响输入体验）
      }
    })();
  }

  return Decoration.widget(pos, widget, {
    side: 1, // 在位置右侧插入 Widget
    key: 'autocomplete', // 唯一标识，用于查找和管理
    ignoresSelection: true, // 点击时不影响编辑器选区
    atomic: true, // 将 Widget 视为一个原子单位
  });
}

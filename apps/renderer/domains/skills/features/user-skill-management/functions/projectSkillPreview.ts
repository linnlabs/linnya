import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const markdown = new MarkdownIt({ html: false, breaks: true });

/** 元数据已在卡片标题展示，预览只渲染正文；这一步绝不回写 Skill 原文。 */
export function projectSkillPreview(path: string, content: string): { html: string } | { text: string } {
  if (!/\.(md|markdown)$/i.test(path)) return { text: content };
  const body = path === 'SKILL.md'
    ? content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    : content;
  // 预览卡片本身是编辑入口，正文不嵌套可聚焦链接，避免点击链接同时打开编辑器。
  return { html: DOMPurify.sanitize(markdown.render(body), { FORBID_TAGS: ['a'] }) };
}

/**
 * @file markdownJsonSerializer.ts
 * @description 将 Workspace Markdown 文档的 Tiptap/ProseMirror JSON（content_json）序列化为 Markdown 文本（后端纯函数版）
 *
 * 背景：
 * - Workspace 的“真相来源”是块结构 JSON（doc -> rootBlock -> ...），不是 markdown 字符串；
 * - 但 AI read 工具需要“带 Markdown 语法”的可读文本，避免丢失标题/列表/代码块等语义；
 * - 前端已有 markdownSerializer（依赖 ProseMirror Schema/Node），后端工具不应依赖前端 Schema，
 *   因此这里实现一个**只依赖 JSON** 的序列化器：稳定、可测试、无任何 any 断言。
 *
 * 设计原则：
 * - 严格按当前项目的节点/mark 命名做序列化（baseBlock/headingBlock/listItemBlock/table...）；
 * - 未识别的节点不会“猜测修复”，只会递归提取其子树可见文本，保证输出可读但不虚构语义；
 * - 仅负责“导出为 Markdown”，不负责反向解析。
 */

import {
  MarkdownAnnotationsSchema,
  encodeMarkdownEmptyBlockAnnotationAnchorComment,
  encodeMarkdownAnnotationComment,
} from '@app/schemas';

type JsonRecord = Record<string, unknown>;

type JsonNode = {
  type?: unknown;
  attrs?: unknown;
  content?: unknown;
  text?: unknown;
  marks?: unknown;
};

type JsonMark = {
  type?: unknown;
  attrs?: unknown;
};

export interface MarkdownInlineMark {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
}

export interface MarkdownInlineTextProjectionInput {
  readonly rawText: string;
  readonly marks: readonly MarkdownInlineMark[];
}

export type MarkdownInlineTextProjector = (
  input: MarkdownInlineTextProjectionInput
) => string | null;

export interface MarkdownInlineNodeProjectionInput {
  readonly type: string;
  readonly attrs: Readonly<Record<string, unknown>>;
  readonly marks: readonly MarkdownInlineMark[];
}

export type MarkdownInlineNodeProjector = (
  input: MarkdownInlineNodeProjectionInput
) => string | null;

export interface SerializeRootBlockToMarkdownOptions {
  /**
   * 可选的领域行内投影。返回字符串时完整替换当前 text node 的默认 Markdown 输出；返回 null
   * 时继续走既有转义与 mark wrapper。调用方负责 projector 自身的跨 text-node 状态隔离。
   */
  readonly projectInlineText?: MarkdownInlineTextProjector;
  /** 结构化 inline atom 的领域投影；CitationNode 等节点不应降级读取 textContent。 */
  readonly projectInlineNode?: MarkdownInlineNodeProjector;
  /** 文件写入规划比较正文时关闭；默认导出仍完整包含 canonical Annotation。 */
  readonly includeAnnotations?: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asNode(value: unknown): JsonNode | null {
  if (!isRecord(value)) return null;
  return value as JsonNode;
}

function getType(node: JsonNode | null): string | null {
  const t = node?.type;
  return typeof t === 'string' && t.trim().length > 0 ? t : null;
}

function getAttrs(node: JsonNode | null): JsonRecord {
  const attrs = node?.attrs;
  return isRecord(attrs) ? attrs : {};
}

function getContent(node: JsonNode | null): unknown[] {
  const c = node?.content;
  return Array.isArray(c) ? c : [];
}

function getText(node: JsonNode | null): string | null {
  const t = node?.text;
  return typeof t === 'string' ? t : null;
}

function getMarks(node: JsonNode | null): JsonMark[] {
  const marks = node?.marks;
  if (!Array.isArray(marks)) return [];
  return marks.map(m => (isRecord(m) ? (m as JsonMark) : null)).filter((m): m is JsonMark => !!m);
}

function getStringAttr(attrs: JsonRecord, key: string): string | null {
  const v = attrs[key];
  return typeof v === 'string' ? v : null;
}

function getNumberAttr(attrs: JsonRecord, key: string): number | null {
  const v = attrs[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function repeat(str: string, count: number): string {
  if (count <= 0) return '';
  return new Array(count).fill(str).join('');
}

/**
 * 转义普通文本（非 code 场景），避免内容被误解释为 Markdown 语法。
 *
 * 注意：这与“用户原始 markdown”并不等价；我们导出的目标是：
 * - 最大程度保留语义（标题/列表/粗体等），同时保证输出是合法 Markdown；
 * - 对纯文本中的特殊字符进行转义，避免破坏结构。
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\') // 反斜杠
    .replace(/\*/g, '\\*') // 星号
    .replace(/_/g, '\\_') // 下划线
    .replace(/#/g, '\\#') // 井号
    .replace(/\[/g, '\\[') // 左方括号
    .replace(/\]/g, '\\]') // 右方括号
    .replace(/\(/g, '\\(') // 左圆括号
    .replace(/\)/g, '\\)') // 右圆括号
    .replace(/`/g, '\\`') // 反引号
    .replace(/~/g, '\\~') // 波浪号
    .replace(/>/g, '\\>') // 大于号
    .replace(/\|/g, '\\|'); // 竖线
}

function escapeInlineCodeText(text: string): string {
  // 行内代码主要需要处理反引号，否则会破坏包裹。
  // 这里使用最小转义策略（反引号前加反斜杠）。
  return text.replace(/`/g, '\\`');
}

function escapeLinkHref(href: string): string {
  // 只做必要转义：括号会破坏 Markdown link 的 url 部分
  return href.replace(/([()])/g, '\\$1');
}

type MarkWrapper = { open: string; close: string; priority: number };

function getMarkWrapper(mark: JsonMark): MarkWrapper | null {
  const type = typeof mark.type === 'string' ? mark.type : null;
  if (!type) return null;

  // 约定：link 应该是“最外层”包裹，使得 [**bold**](url) 成立
  if (type === 'link') {
    const attrs = isRecord(mark.attrs) ? (mark.attrs as JsonRecord) : {};
    const href = getStringAttr(attrs, 'href');
    if (!href || href.trim().length === 0) return null;
    const safeHref = escapeLinkHref(href);
    return { open: '[', close: `](${safeHref})`, priority: 0 };
  }

  if (type === 'code') return { open: '`', close: '`', priority: 10 };
  if (type === 'bold') return { open: '**', close: '**', priority: 20 };
  if (type === 'italic') return { open: '*', close: '*', priority: 30 };
  if (type === 'strike') return { open: '~~', close: '~~', priority: 40 };

  // 其他 marks（例如 textColor/highlight/underline）暂不导出为 Markdown 语法：
  // - 这是导出能力的缺失，而不是“猜测性修复”；
  // - 仍会通过纯文本输出保留可读性。
  return null;
}

function applyMarks(rawText: string, marks: JsonMark[], mode: 'text' | 'inline_code'): string {
  const wrappers = marks
    .map(getMarkWrapper)
    .filter((w): w is MarkWrapper => !!w)
    .sort((a, b) => a.priority - b.priority);

  const text = mode === 'inline_code' ? escapeInlineCodeText(rawText) : escapeText(rawText);

  if (wrappers.length === 0) return text;
  const open = wrappers.map(w => w.open).join('');
  const close = [...wrappers]
    .reverse()
    .map(w => w.close)
    .join('');
  return `${open}${text}${close}`;
}

function extractPlainText(node: unknown): string {
  const n = asNode(node);
  if (!n) return '';
  const direct = getText(n);
  if (typeof direct === 'string') return direct;
  return getContent(n).map(extractPlainText).join('');
}

type InlineSerializeContext = {
  /**
   * 是否处于 codeBlock / latexBlock 的纯文本上下文。
   * - true：不做 Markdown 特殊字符转义
   * - false：对普通文本做转义
   */
  inCodeBlock: boolean;
  projectInlineText?: MarkdownInlineTextProjector;
  projectInlineNode?: MarkdownInlineNodeProjector;
};

function toPublicMarks(marks: readonly JsonMark[]): readonly MarkdownInlineMark[] {
  return marks.flatMap(mark => {
    if (typeof mark.type !== 'string' || mark.type.trim().length === 0) return [];
    return [
      {
        type: mark.type,
        ...(isRecord(mark.attrs) ? { attrs: mark.attrs } : {}),
      },
    ];
  });
}

function serializeInline(node: unknown, ctx: InlineSerializeContext): string {
  const n = asNode(node);
  if (!n) return '';

  const type = getType(n);

  if (!ctx.inCodeBlock && type) {
    const projectedNode = ctx.projectInlineNode?.({
      type,
      attrs: getAttrs(n),
      marks: toPublicMarks(getMarks(n)),
    });
    if (typeof projectedNode === 'string') return projectedNode;
  }

  // 文本节点：套 marks
  if (type === 'text') {
    const t = getText(n) ?? '';
    const marks = getMarks(n);
    const hasInlineCodeMark = marks.some(m => m.type === 'code');

    // codeBlock 内：不转义（只处理行内 code 的反引号转义）
    if (ctx.inCodeBlock) {
      return hasInlineCodeMark ? applyMarks(t, marks, 'inline_code') : t;
    }

    const projected = ctx.projectInlineText?.({ rawText: t, marks: toPublicMarks(marks) });
    if (typeof projected === 'string') return projected;

    return hasInlineCodeMark ? applyMarks(t, marks, 'inline_code') : applyMarks(t, marks, 'text');
  }

  // 硬换行
  if (type === 'hardBreak') {
    // 标准 Markdown：两个空格 + 换行
    return '  \n';
  }

  // 行内 LaTeX：$...$
  if (type === 'inlineLatex') {
    const attrs = getAttrs(n);
    const source = getStringAttr(attrs, 'latexSource') ?? extractPlainText(n);
    const escaped = source.replace(/\$/g, '\\$');
    return `$${escaped}$`;
  }

  // 默认：递归渲染子内容
  return getContent(n)
    .map(child => serializeInline(child, ctx))
    .join('');
}

function prefixEveryLine(text: string, prefix: string): string {
  return text
    .split(/\r?\n/)
    .map(line => `${prefix}${line}`)
    .join('\n');
}

function serializeTable(
  node: JsonNode,
  projectInlineText?: MarkdownInlineTextProjector,
  projectInlineNode?: MarkdownInlineNodeProjector
): string {
  // table -> tableRow+ -> tableHeader/tableCell -> tableCellContentBlock -> inline
  const rows: string[][] = [];
  for (const rowRaw of getContent(node)) {
    const row = asNode(rowRaw);
    if (!row || getType(row) !== 'tableRow') continue;

    const cells: string[] = [];
    for (const cellRaw of getContent(row)) {
      const cell = asNode(cellRaw);
      const cellType = getType(cell);
      if (!cell || (cellType !== 'tableCell' && cellType !== 'tableHeader')) continue;

      const cellText = getContent(cell)
        .map(child => {
          const childNode = asNode(child);
          if (childNode && getType(childNode) === 'tableCellContentBlock') {
            // 表格单元格：把换行压成空格，避免破坏 pipe table
            const inline = serializeInline(childNode, {
              inCodeBlock: false,
              projectInlineText,
              projectInlineNode,
            });
            return inline.replace(/\r?\n/g, ' ');
          }
          return serializeInline(childNode, {
            inCodeBlock: false,
            projectInlineText,
            projectInlineNode,
          }).replace(/\r?\n/g, ' ');
        })
        .join('')
        .trim();

      // | 必须转义，否则会破坏表格结构
      cells.push(cellText.replace(/\|/g, '\\|'));
    }

    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return '';

  const [header, ...body] = rows;
  const headerLine = `| ${header.join(' | ')} |`;
  const sepLine = `| ${header.map(() => '---').join(' | ')} |`;
  const bodyLines = body.map(r => `| ${r.join(' | ')} |`);
  return [headerLine, sepLine, ...bodyLines].join('\n');
}

function serializeBlockChild(
  node: JsonNode,
  projectInlineText?: MarkdownInlineTextProjector,
  projectInlineNode?: MarkdownInlineNodeProjector
): string {
  const type = getType(node);
  const attrs = getAttrs(node);

  if (type === 'baseBlock') {
    const inline = getContent(node)
      .map(c => serializeInline(c, { inCodeBlock: false, projectInlineText, projectInlineNode }))
      .join('');
    return inline.trimEnd();
  }

  if (type === 'headingBlock') {
    const level = getNumberAttr(attrs, 'level') ?? 1;
    const hashes = repeat('#', Math.max(1, Math.min(6, Math.floor(level))));
    const inline = getContent(node)
      .map(c => serializeInline(c, { inCodeBlock: false, projectInlineText, projectInlineNode }))
      .join('');
    return `${hashes} ${inline}`.trimEnd();
  }

  if (type === 'quoteBlock') {
    const inline = getContent(node)
      .map(c => serializeInline(c, { inCodeBlock: false, projectInlineText, projectInlineNode }))
      .join('');
    const body = inline.length > 0 ? inline : '';
    return prefixEveryLine(body, '> ').trimEnd();
  }

  if (type === 'codeBlock') {
    const language = getStringAttr(attrs, 'language') ?? '';
    const code = extractPlainText(node);
    return `\`\`\`${language}\n${code}\n\`\`\``.trimEnd();
  }

  if (type === 'latexBlock') {
    const latex = getStringAttr(attrs, 'latexSource') ?? '';
    return `\`\`\`latex\n${latex}\n\`\`\``.trimEnd();
  }

  if (type === 'horizontalRuleBlock') {
    return '---';
  }

  if (type === 'listItemBlock') {
    const level = getNumberAttr(attrs, 'level') ?? 0;
    const listType = getStringAttr(attrs, 'listType');
    const marker = listType === 'ordered' ? '1. ' : '* ';
    const indent = repeat('  ', Math.max(0, Math.floor(level)));
    const inline = getContent(node)
      .map(c => serializeInline(c, { inCodeBlock: false, projectInlineText, projectInlineNode }))
      .join('');

    // 处理多行：后续行按“缩进 + 两个空格”对齐到文本起始位置（简化的 hanging indent）
    const lines = inline.split(/\r?\n/);
    const first = `${indent}${marker}${lines[0] ?? ''}`;
    const restPrefix = `${indent}${repeat(' ', marker.length)}`;
    const rest = lines.slice(1).map(l => `${restPrefix}${l}`);
    return [first, ...rest].join('\n').trimEnd();
  }

  if (type === 'table') {
    const md = serializeTable(node, projectInlineText, projectInlineNode);
    return md.trimEnd();
  }

  if (type === 'imageBlock') {
    const alt = getStringAttr(attrs, 'alt') ?? '图片';
    const width = getNumberAttr(attrs, 'width');
    const height = getNumberAttr(attrs, 'height');

    // 与前端导出保持一致：图片导出为占位描述文本（避免 base64/本地路径泄露与不可读）
    let description = `[图片：${alt}`;
    if (width || height) {
      if (width) description += `，宽度${width}px`;
      if (height) description += `，高度${height}px`;
    }
    description += ']';
    return description;
  }

  if (type === 'audioBlock') {
    const src = getStringAttr(attrs, 'src') ?? '';
    if (src.trim().length === 0) return '[空音频块]';
    return `[音频文件](${escapeLinkHref(src)})`;
  }

  // 未识别块：递归提取可见文本，保证可读
  // 注意：不做“猜测性 Markdown 结构化”，避免产生虚假语义。
  const fallback = getContent(node)
    .map(c => serializeInline(c, { inCodeBlock: false, projectInlineText, projectInlineNode }))
    .join('');
  return fallback.trimEnd();
}

/**
 * 将单个 rootBlock（含其内部子块）导出为 Markdown。
 */
export function serializeRootBlockToMarkdown(
  rootBlock: unknown,
  options: SerializeRootBlockToMarkdownOptions = {}
): string {
  const root = asNode(rootBlock);
  if (!root || getType(root) !== 'rootBlock') return '';

  const children = getContent(root);
  if (children.length === 0) return '';

  const parts: string[] = [];
  for (const child of children) {
    const n = asNode(child);
    if (!n) continue;
    const md = serializeBlockChild(n, options.projectInlineText, options.projectInlineNode);
    if (md.length > 0) parts.push(md);
    else parts.push(''); // 空块保留为空串，便于 ref 仍可定位
  }

  // Annotation 随 root block 进入同一个 Markdown 逻辑单元，不能获得独立 ref。
  const body = parts.join('\n\n').trimEnd();
  if (options.includeAnnotations === false) return body;
  const annotations = MarkdownAnnotationsSchema.parse(getAttrs(root)['annotations'] ?? []);
  if (annotations.length === 0) return body;
  const anchor = body.length === 0
    ? encodeMarkdownEmptyBlockAnnotationAnchorComment()
    : body;

  return [anchor, ...annotations.map(encodeMarkdownAnnotationComment)]
    .filter(part => part.length > 0)
    .join('\n\n');
}

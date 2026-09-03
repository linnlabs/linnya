import {
  getMarkdown,
  parseMarkdownToStructure,
  type CodeBlockNode,
  type DefinitionItemNode,
  type DefinitionListNode,
  type EmojiNode,
  type HeadingNode,
  type LinkNode,
  type ListItemNode,
  type ListNode,
  type ParagraphNode,
  type ParsedNode,
  type ReferenceNode,
  type TableNode,
} from '../../../../../../../packages/stream-markdown-parser/src/index.ts';
import type { BaseMessage, ToolCallMessage } from '../../../types';
import type { EstimationRegistry } from './estimationRegistry';
import {
  calculateImageGenerationResultHeight,
  type ImageGenerationSingleRatio,
} from '../../../functions/conversationImageLayout';
import { TextMeasureService } from '../../../../../../../src/features/text-measurement/orchestration/TextMeasureService.js';
import { HeuristicMeasureAdapter } from '../../../../../../../src/features/text-measurement/adapters/HeuristicMeasureAdapter.js';
import { BrowserPretextAdapter } from '../../../../../../../src/features/text-measurement/adapters/BrowserPretextAdapter.js';

const POINTS_PER_PIXEL = 72 / 96;
const DEFAULT_ESTIMATION_WIDTH_PX = 720;
const MIN_CONTENT_WIDTH_PX = 220;
const USER_IMAGE_GALLERY_MAX_WIDTH_PX = 384;
const USER_IMAGE_GALLERY_GAP_PX = 4;
const USER_IMAGE_GALLERY_BOTTOM_MARGIN_PX = 4;

const markdown = getMarkdown('conversation-estimation');
const textMeasureService = new TextMeasureService({
  primary: new BrowserPretextAdapter(),
  fallback: new HeuristicMeasureAdapter(),
});

type TextStyleSpec = {
  fontSizePx: number;
  lineHeightPx: number;
};

type ContentHeightKind = 'markdown' | 'plain-user-input';

interface CachedContentHeight {
  content: string;
  height: number;
  containsTable: boolean;
}

interface ContentHeightParts {
  estimated: number;
  deterministic: number;
  containsTable: boolean;
}

interface MessageHeightComponents {
  estimatedHeight: number;
  deterministicHeight: number;
  containsTable: boolean;
}

interface MeasuredImageMedia {
  path: string;
  width: number;
  height: number;
}

export interface ConversationMessageLayoutEstimate {
  readonly estimatedHeight: number;
  readonly containsTable: boolean;
}

const MAX_CACHE_BUCKETS_PER_MESSAGE = 8;

/**
 * 消息内容估高缓存。
 *
 * 中文说明：
 * - 对话流式阶段会反复重算最后一个 turn 的 estimatedHeight；
 * - 其中 user_input 在发送后基本不变，如果每个 chunk 都重新解析/测量一遍超长用户输入，
 *   就会把“长请求”变成稳定的主线程开销；
 * - 这里按消息对象弱引用缓存，消息被会话释放后缓存也会自动释放，不需要手动清理。
 */
const contentHeightCache = new WeakMap<BaseMessage, Map<string, CachedContentHeight>>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeWidth(widthPx: number | undefined): number {
  if (typeof widthPx !== 'number' || !Number.isFinite(widthPx) || widthPx <= 0) {
    return DEFAULT_ESTIMATION_WIDTH_PX;
  }
  return widthPx;
}

function toLineHeightMultiplier(style: TextStyleSpec): number {
  return style.lineHeightPx / Math.max(style.fontSizePx, 1);
}

function getContentHeightCacheKey(kind: ContentHeightKind, widthPx: number): string {
  return `${kind}:${Math.round(widthPx)}`;
}

function getCachedContentAnalysis(
  message: BaseMessage,
  kind: ContentHeightKind,
  widthPx: number,
  compute: (content: string) => Pick<CachedContentHeight, 'containsTable' | 'height'>,
): CachedContentHeight {
  const content = String(message.content ?? '');
  const key = getContentHeightCacheKey(kind, widthPx);
  const messageCache = contentHeightCache.get(message);
  const cached = messageCache?.get(key);

  if (cached && cached.content === content) {
    return cached;
  }

  const analysis = compute(content);
  const nextMessageCache = messageCache ?? new Map<string, CachedContentHeight>();
  if (!nextMessageCache.has(key) && nextMessageCache.size >= MAX_CACHE_BUCKETS_PER_MESSAGE) {
    const oldestKey = nextMessageCache.keys().next().value;
    if (typeof oldestKey === 'string') {
      nextMessageCache.delete(oldestKey);
    }
  }
  const nextCached = { content, ...analysis };
  nextMessageCache.set(key, nextCached);
  if (!messageCache) {
    contentHeightCache.set(message, nextMessageCache);
  }
  return nextCached;
}

function measureTextBlockHeight(text: string, widthPx: number, style: TextStyleSpec): number {
  const measurement = textMeasureService.measure({
    paragraphs: [{ text }],
    style: {
      fontSizePt: style.fontSizePx * POINTS_PER_PIXEL,
      lineHeightMultiplier: toLineHeightMultiplier(style),
    },
    box: {
      widthInches: widthPx / 96,
      wrap: 'word',
    },
    sourceKind: 'ui-runtime',
  });
  return measurement.contentHeightInches * 96;
}

function getNodeChildren(node: ParsedNode): ParsedNode[] {
  if ('children' in node && Array.isArray((node as { children?: unknown }).children)) {
    return (node as { children: ParsedNode[] }).children;
  }
  return [];
}

function extractInlineText(nodes: ParsedNode[]): string {
  return nodes.map((node) => {
    switch (node.type) {
      case 'text':
        return node.content;
      case 'link':
        return extractInlineText((node as LinkNode).children);
      case 'strong':
      case 'emphasis':
      case 'strikethrough':
      case 'highlight':
      case 'insert':
      case 'subscript':
      case 'superscript':
      case 'paragraph':
      case 'inline':
      case 'blockquote':
      case 'list_item':
      case 'table_cell':
      case 'heading':
        return extractInlineText(getNodeChildren(node));
      case 'inline_code':
        return node.code;
      case 'math_inline':
      case 'math_block':
        return node.content;
      case 'hardbreak':
        return '\n';
      case 'reference':
        return `[${(node as ReferenceNode).id}]`;
      case 'emoji':
        return (node as EmojiNode).markup;
      default:
        return '';
    }
  }).join('');
}

function estimateHeadingHeight(node: HeadingNode, widthPx: number): number {
  const fontSizePx = node.level <= 1 ? 22 : node.level === 2 ? 18 : 16;
  const lineHeightPx = node.level <= 1 ? 32 : 28;
  return measureTextBlockHeight(extractInlineText(node.children), widthPx, {
    fontSizePx,
    lineHeightPx,
  }) + 12;
}

function estimateListItemHeight(node: ListItemNode, widthPx: number): number {
  return estimateNodeCollectionHeight(node.children, Math.max(widthPx - 20, MIN_CONTENT_WIDTH_PX)) + 8;
}

function estimateListHeight(node: ListNode, widthPx: number): number {
  return node.items.reduce((sum, item) => sum + estimateListItemHeight(item, widthPx), 0) + 8;
}

function estimateCodeBlockHeight(node: CodeBlockNode, widthPx: number): number {
  const lines = node.code.split('\n').length;
  const innerWidth = Math.max(widthPx - 24, MIN_CONTENT_WIDTH_PX);
  const bodyHeight = measureTextBlockHeight(node.code, innerWidth, {
    fontSizePx: 13,
    lineHeightPx: 20,
  });
  return Math.max(lines * 20, bodyHeight) + 28;
}

function estimateTableHeight(node: TableNode, widthPx: number): number {
  const columnCount = Math.max(node.header.cells.length, 1);
  const innerWidth = Math.max(widthPx - 16, MIN_CONTENT_WIDTH_PX);
  const columnWidth = Math.max(innerWidth / columnCount, 80);
  const headerHeight = node.header.cells.reduce((max, cell) => Math.max(
    max,
    measureTextBlockHeight(extractInlineText(cell.children), columnWidth, {
      fontSizePx: 13,
      lineHeightPx: 20,
    }),
  ), 0) + 18;
  const rowHeights = node.rows.map((row) => row.cells.reduce((max, cell) => Math.max(
    max,
    measureTextBlockHeight(extractInlineText(cell.children), columnWidth, {
      fontSizePx: 14,
      lineHeightPx: 22,
    }),
  ), 0) + 18);
  return headerHeight + rowHeights.reduce((sum, height) => sum + height, 0) + 12;
}

function estimateParagraphLikeHeight(text: string, widthPx: number, style: TextStyleSpec, gapPx: number): number {
  return measureTextBlockHeight(text, widthPx, style) + gapPx;
}

function estimateNodeHeight(node: ParsedNode, widthPx: number): number {
  switch (node.type) {
    case 'heading':
      return estimateHeadingHeight(node as HeadingNode, widthPx);
    case 'paragraph':
      return estimateParagraphLikeHeight(extractInlineText((node as ParagraphNode).children), widthPx, {
        fontSizePx: 15,
        lineHeightPx: 24,
      }, 12);
    case 'list':
      return estimateListHeight(node as ListNode, widthPx);
    case 'code_block':
      return estimateCodeBlockHeight(node as CodeBlockNode, widthPx);
    case 'table':
      return estimateTableHeight(node as TableNode, widthPx);
    case 'blockquote':
      return estimateNodeCollectionHeight(getNodeChildren(node), Math.max(widthPx - 20, MIN_CONTENT_WIDTH_PX)) + 16;
    case 'math_block':
      return estimateParagraphLikeHeight(String((node as { content?: unknown }).content ?? ''), widthPx, {
        fontSizePx: 16,
        lineHeightPx: 26,
      }, 12);
    case 'thematic_break':
      return 18;
    case 'image':
      return 240;
    case 'html_block':
      return estimateParagraphLikeHeight(String((node as { content?: unknown }).content ?? ''), widthPx, {
        fontSizePx: 14,
        lineHeightPx: 22,
      }, 12);
    case 'definition_list':
      return (node as DefinitionListNode).items.reduce((sum: number, item: DefinitionItemNode) => (
        sum
        + estimateParagraphLikeHeight(extractInlineText(item.term), widthPx, { fontSizePx: 15, lineHeightPx: 24 }, 6)
        + estimateParagraphLikeHeight(extractInlineText(item.definition), Math.max(widthPx - 16, MIN_CONTENT_WIDTH_PX), { fontSizePx: 14, lineHeightPx: 22 }, 10)
      ), 0);
    default: {
      const children = getNodeChildren(node);
      if (children.length > 0) {
        return estimateNodeCollectionHeight(children, widthPx);
      }
      const rawContent = (node as { content?: unknown }).content;
      if (typeof rawContent === 'string') {
        return estimateParagraphLikeHeight(rawContent, widthPx, {
          fontSizePx: 15,
          lineHeightPx: 24,
        }, 8);
      }
      return 0;
    }
  }
}

function estimateNodeCollectionHeight(nodes: ParsedNode[], widthPx: number): number {
  return nodes.reduce((sum, node) => sum + estimateNodeHeight(node, widthPx), 0);
}

function estimateMarkdownContent(content: string, widthPx: number): Pick<CachedContentHeight, 'containsTable' | 'height'> {
  if (content.trim().length === 0) {
    return { height: 0, containsTable: false };
  }
  const nodes = parseMarkdownToStructure(content, markdown);
  return {
    height: estimateNodeCollectionHeight(nodes, widthPx),
    containsTable: nodes.some(node => node.type === 'table'),
  };
}

function estimatePlainUserInputContent(content: string, widthPx: number): Pick<CachedContentHeight, 'containsTable' | 'height'> {
  if (content.trim().length === 0) {
    return { height: 0, containsTable: false };
  }

  /**
   * 中文说明：
   * - UserMessage 当前用 `v-text + white-space: pre-wrap` 渲染，不走 Markdown；
   * - 因此用户输入估高也走纯文本测量，避免超长请求在每个流式 chunk 到来时被 Markdown parser 全量解析。
   * - 这里复用现有 TextMeasureService。浏览器环境优先走 pretext，Node/异常时自动回退启发式测量。
   */
  return {
    height: measureTextBlockHeight(content, widthPx, {
      fontSizePx: 13,
      lineHeightPx: 19,
    }),
    containsTable: false,
  };
}

function estimateUserImageGalleryHeight(message: BaseMessage, widthPx: number): number {
  const imageCount = message.attachments?.length ?? 0;
  if (imageCount === 0) return 0;
  const galleryWidth = Math.min(widthPx, USER_IMAGE_GALLERY_MAX_WIDTH_PX);
  if (imageCount === 1) {
    return (galleryWidth * 10 / 16) + USER_IMAGE_GALLERY_BOTTOM_MARGIN_PX;
  }
  const columnWidth = (galleryWidth - USER_IMAGE_GALLERY_GAP_PX) / 2;
  const rowHeight = columnWidth * 3 / 4;
  const rowCount = Math.ceil(imageCount / 2);
  return (rowCount * rowHeight)
    + ((rowCount - 1) * USER_IMAGE_GALLERY_GAP_PX)
    + USER_IMAGE_GALLERY_BOTTOM_MARGIN_PX;
}

function contentEstimated(height: number, containsTable = false): ContentHeightParts {
  return { estimated: height, deterministic: 0, containsTable };
}

function contentDeterministic(height: number): ContentHeightParts {
  return { estimated: 0, deterministic: height, containsTable: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readToolResultImageMedia(value: unknown): MeasuredImageMedia[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MeasuredImageMedia => {
    if (!isRecord(item)) return false;
    return typeof item.path === 'string'
      && item.path.trim().length > 0
      && readPositiveNumber(item.width) !== undefined
      && readPositiveNumber(item.height) !== undefined;
  });
}

function readImageGenerationDataPaths(result: Record<string, unknown>): string[] {
  const data = result.data;
  if (typeof data === 'string' && data.trim().length > 0) {
    return [data.trim()];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readSingleImageRatio(
  imagePath: string,
  media: readonly MeasuredImageMedia[],
): ImageGenerationSingleRatio | undefined {
  const matched = media.find((item) => item.path.trim() === imagePath);
  if (!matched) return undefined;
  return { width: matched.width, height: matched.height };
}

function estimateImageGenerationContentHeight(
  message: ToolCallMessage,
  contentWidthPx: number,
): ContentHeightParts | undefined {
  const metadata = message.metadata;
  if (metadata.tool_name !== 'generate_image' && metadata.tool_name !== 'text_to_image') {
    return undefined;
  }

  if (metadata.data === undefined) {
    return undefined;
  }
  const result = { data: metadata.data };

  const imagePaths = readImageGenerationDataPaths(result);
  if (imagePaths.length === 0) {
    return undefined;
  }

  const media = readToolResultImageMedia(metadata.presentation?.media);
  const singleImageRatio = imagePaths.length === 1
    ? readSingleImageRatio(imagePaths[0], media)
    : undefined;

  const height = calculateImageGenerationResultHeight(
    imagePaths.length,
    singleImageRatio,
    contentWidthPx,
  );
  return contentDeterministic(height);
}

function estimateMessageContentHeightParts(
  message: BaseMessage,
  widthPx: number,
  registry: EstimationRegistry,
): ContentHeightParts {
  const textWidth = Math.max(widthPx - registry.message.horizontalPaddingPx, MIN_CONTENT_WIDTH_PX);
  switch (message.type) {
    case 'user_input': {
      const analysis = getCachedContentAnalysis(
        message,
        'plain-user-input',
        textWidth,
        (content) => estimatePlainUserInputContent(content, textWidth),
      );
      return contentEstimated(
        analysis.height + estimateUserImageGalleryHeight(message, textWidth),
        analysis.containsTable,
      );
    }
    case 'tool_calls':
      return estimateImageGenerationContentHeight(message, textWidth) ?? contentEstimated(88);
    default: {
      const analysis = getCachedContentAnalysis(
        message,
        'markdown',
        textWidth,
        (content) => estimateMarkdownContent(content, textWidth),
      );
      return contentEstimated(analysis.height, analysis.containsTable);
    }
  }
}

export function estimateConversationMessageLayout(
  message: BaseMessage,
  registry: EstimationRegistry,
  widthPx?: number,
): ConversationMessageLayoutEstimate {
  const components = estimateConversationMessageHeightComponents(message, registry, widthPx);
  return {
    estimatedHeight: components.estimatedHeight + components.deterministicHeight,
    containsTable: components.containsTable,
  };
}

function estimateConversationMessageHeightComponents(
  message: BaseMessage,
  registry: EstimationRegistry,
  widthPx?: number,
): MessageHeightComponents {
  if (message.type === 'thought' && message.metadata.is_complete) {
    // 完成态 Thought 首次挂载必然折叠且正文不进入 DOM。这里必须与展示状态一致，
    // 否则离屏估高会为了不可见正文解析整段 Markdown，并制造远大于折叠壳的高度。
    return {
      estimatedHeight: registry.message.min,
      deterministicHeight: 0,
      containsTable: false,
    };
  }

  const resolvedWidth = normalizeWidth(widthPx);
  const content = estimateMessageContentHeightParts(message, resolvedWidth, registry);
  return {
    estimatedHeight: clamp(
      registry.message.base
        + registry.message.verticalPaddingPx
        + content.estimated,
      registry.message.min,
      registry.message.max,
    ),
    deterministicHeight: content.deterministic,
    containsTable: content.containsTable,
  };
}

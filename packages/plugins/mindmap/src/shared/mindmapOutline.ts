/**
 * @file mindmapOutline.ts
 * @description MindMap 的 Markdown outline 解析与内容规范化纯函数。
 *
 * 中文说明：
 * - 这里不触达 DB，也不依赖工具层；
 * - write_file / edit_file / 旧创建工具都应复用这里的领域能力；
 * - 当前阶段只表达纯思维导图树，不承载 hypothesis / evidence / citation 等研究语义。
 */

import { v4 as uuidv4 } from 'uuid';
import type { DraftMindMapData, MindMapData, MindMapNodeData, MindMapTheme } from './mindMapData';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readTheme(value: unknown): MindMapTheme | undefined {
  return isRecord(value) ? { ...value } : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeNode(value: unknown, fallbackTopic: string, isRoot: boolean): MindMapNodeData {
  const src = isRecord(value) ? value : {};
  const {
    id: rawId,
    topic: rawTopic,
    children: rawChildren,
    root: rawRoot,
    ...rest
  } = src;
  const children = Array.isArray(rawChildren)
    ? rawChildren.map((child) => normalizeNode(child, '未命名', false))
    : [];

  const node: MindMapNodeData = {
    ...rest,
    id: readString(rawId) ?? uuidv4(),
    topic: readString(rawTopic) ?? fallbackTopic,
    children,
  };

  if (isRoot) {
    node.root = true;
  } else if (typeof rawRoot === 'boolean') {
    node.root = rawRoot;
  }

  return node;
}

/**
 * 将 Markdown 大纲文本解析为简单的 MindMapContent 结构。
 *
 * 设计约定（对 AI 友好，降低认知负荷）：
 * - 可选的第一行标题（以 "#" 开头）作为根节点标题；
 * - 支持嵌套列表与 `##` / `###` heading 大纲；
 * - 列表项支持 `-` / `*` / `+` / `1.` 等常见写法。
 *
 * 如果解析不到子节点，将退化为仅包含根节点的思维导图。
 */
export function parseMindmapMarkdownOutline(outline: string, defaultTitle: string): DraftMindMapData {
  let rootTitle = defaultTitle;
  const lines = outline.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch && headingMatch[1].trim().length > 0) {
      rootTitle = headingMatch[1].trim();
    }
    break;
  }

  type SimpleNode = {
    topic: string;
    children: SimpleNode[];
  };

  const root: SimpleNode = {
    topic: rootTitle,
    children: [],
  };

  const stack: { node: SimpleNode; level: number }[] = [{ node: root, level: 0 }];
  let currentHeadingLevel = 0;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim()) {
      continue;
    }

    const trimmed = line.trim();
    const rootHeadingMatch = /^#\s+(.*)$/.exec(trimmed);
    if (rootHeadingMatch) {
      continue;
    }

    const headingMatch = /^(#{2,6})\s+(.*\S)\s*$/.exec(trimmed);
    if (headingMatch) {
      const content = headingMatch[2].trim();
      if (!content) {
        continue;
      }

      const absoluteLevel = Math.max(1, headingMatch[1].length - 1);
      while (stack.length > 0 && stack[stack.length - 1].level >= absoluteLevel) {
        stack.pop();
      }

      const parentEntry = stack[stack.length - 1] ?? { node: root, level: 0 };
      const newNode: SimpleNode = {
        topic: content,
        children: [],
      };
      parentEntry.node.children.push(newNode);
      stack.push({ node: newNode, level: absoluteLevel });
      currentHeadingLevel = absoluteLevel;
      continue;
    }

    const bulletMatch = /^(\s*)([-*+]|\d+\.)\s+(.*\S)\s*$/.exec(line);
    if (!bulletMatch) {
      continue;
    }

    const indent = bulletMatch[1] ?? '';
    const content = bulletMatch[3].trim();
    if (!content) {
      continue;
    }

    const spaceCount = indent.replace(/\t/g, '  ').length;
    const indentLevel = Math.max(0, Math.floor(spaceCount / 2));
    let absoluteLevel = currentHeadingLevel > 0
      ? currentHeadingLevel + 1 + indentLevel
      : 1 + indentLevel;

    // AI 输出偶尔会跳级缩进；这里压回相邻层，避免产生不可见的空父节点。
    if (absoluteLevel > stack[stack.length - 1].level + 1) {
      absoluteLevel = stack[stack.length - 1].level + 1;
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= absoluteLevel) {
      stack.pop();
    }

    const parentEntry = stack[stack.length - 1] ?? { node: root, level: 0 };
    const newNode: SimpleNode = {
      topic: content,
      children: [],
    };
    parentEntry.node.children.push(newNode);
    stack.push({ node: newNode, level: absoluteLevel });
  }

  return {
    nodeData: {
      topic: root.topic,
      children: root.children,
    },
    arrows: [],
    summaries: [],
    direction: 1,
  };
}

export function normalizeMindmap(input: unknown, name: string): MindMapData {
  const src = isRecord(input) ? input : {};
  const {
    nodeData: rawNodeData,
    arrows: rawArrows,
    summaries: rawSummaries,
    direction: rawDirection,
    theme: rawTheme,
    ...rest
  } = src;
  const nodeData = normalizeNode(rawNodeData, name, true);
  const direction = typeof rawDirection === 'number' ? rawDirection : 1;
  const theme = readTheme(rawTheme);

  return {
    ...rest,
    nodeData,
    arrows: readArray(rawArrows),
    summaries: readArray(rawSummaries),
    direction,
    theme,
  };
}

export function countMindMapNodes(node: MindMapNodeData): number {
  let count = 1;
  for (const child of node.children) {
    count += countMindMapNodes(child);
  }
  return count;
}

interface MindMapTopicLine {
  readonly depth: number;
  readonly topic: string;
}

function collectMindMapChildTopics(node: unknown, depth: number, lines: MindMapTopicLine[]): void {
  if (!isRecord(node)) return;
  const topic = readString(node.topic) ?? readString(node.text) ?? '';
  if (topic.trim().length > 0) {
    lines.push({ depth, topic: topic.trim() });
  }

  const children = node.children;
  if (!Array.isArray(children)) return;
  for (const child of children) {
    collectMindMapChildTopics(child, depth + 1, lines);
  }
}

export function serializeMindmapToMarkdownOutline(content: unknown): string {
  if (!isRecord(content)) return JSON.stringify(content, null, 2);
  const root = content.nodeData;
  if (!isRecord(root)) return JSON.stringify(content, null, 2);
  const rootTopic = readString(root.topic) ?? readString(root.text);
  if (!rootTopic || rootTopic.trim().length === 0) {
    return JSON.stringify(content, null, 2);
  }

  const lines: MindMapTopicLine[] = [];
  const children = root.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      collectMindMapChildTopics(child, 0, lines);
    }
  }

  const outline = [`# ${rootTopic.trim()}`];
  if (lines.length === 0) return outline[0];

  outline.push('', ...lines.map((line) => `${'  '.repeat(line.depth)}- ${line.topic}`));
  return outline.join('\n');
}

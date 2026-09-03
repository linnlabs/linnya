/**
 * tableCellContentNormalization.js
 *
 * 统一维护 Linnya 表格单元格的内容结构不变量：
 * 每个 tableCell / tableHeader 在语义上都应该收敛为一个 tableCellContentBlock。
 *
 * 这个模块只处理 ProseMirror 文档结构，不依赖 Vue、Toolbar、DOM 或当前 selection。
 * 这样 split / merge / paste / legacy JSON 修复都可以复用同一条规则。
 */

import { Fragment } from 'prosemirror-model';
import { generateBlockId } from '../../../../../shared/utils/idUtils';
import {
  appendTableCellContentWithBoundary,
  createAggregatedTableCellContentBlock,
} from './tableCellContentAggregation';

const TABLE_CELL_NODE_NAMES = new Set(['tableCell', 'tableHeader']);
const TABLE_CELL_CONTENT_BLOCK = 'tableCellContentBlock';
const TABLE_CELL_CONTENT_BLOCK_TYPE = 'tableCellContent';
const DEFAULT_META_KEY = 'normalizedTableCellContent';

function isTableCellNode(node) {
  return Boolean(node && TABLE_CELL_NODE_NAMES.has(node.type?.name));
}

function isTableCellContentBlock(node) {
  return node?.type?.name === TABLE_CELL_CONTENT_BLOCK;
}

function isUsableBlockId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectInlineNodes(node, output) {
  if (!node) return;

  if (node.isInline) {
    output.push(node);
    return;
  }

  node.forEach((childNode) => {
    collectInlineNodes(childNode, output);
  });
}

function flattenNodeToInlineContent(node) {
  if (isTableCellContentBlock(node)) {
    return node.content;
  }

  const inlineNodes = [];
  collectInlineNodes(node, inlineNodes);
  return Fragment.fromArray(inlineNodes);
}

function normalizeContentBlockAttrs(contentBlockNode, createId) {
  const attrs = { ...(contentBlockNode?.attrs || {}) };
  return {
    ...attrs,
    id: isUsableBlockId(attrs.id) ? attrs.id : createId(),
    blockType: TABLE_CELL_CONTENT_BLOCK_TYPE,
  };
}

function createEmptyContentBlock(schema, createId) {
  return schema.nodes[TABLE_CELL_CONTENT_BLOCK].create({
    id: createId(),
    blockType: TABLE_CELL_CONTENT_BLOCK_TYPE,
  });
}

function createWrappedContentBlock(params) {
  const { schema, cellNode, createId } = params;
  const contentBlockType = schema.nodes[TABLE_CELL_CONTENT_BLOCK];
  let aggregatedContent = Fragment.empty;
  let firstContentBlock = null;

  cellNode.forEach((childNode) => {
    if (!firstContentBlock && isTableCellContentBlock(childNode)) {
      firstContentBlock = childNode;
    }

    const nextContent = flattenNodeToInlineContent(childNode);
    aggregatedContent = appendTableCellContentWithBoundary(
      schema,
      aggregatedContent,
      nextContent
    );
  });

  return contentBlockType.create(
    firstContentBlock
      ? normalizeContentBlockAttrs(firstContentBlock, createId)
      : { id: createId(), blockType: TABLE_CELL_CONTENT_BLOCK_TYPE },
    aggregatedContent
  );
}

function needsContentBlockAttrNormalization(contentBlockNode) {
  return !isUsableBlockId(contentBlockNode.attrs?.id)
    || contentBlockNode.attrs?.blockType !== TABLE_CELL_CONTENT_BLOCK_TYPE;
}

export function createNormalizedTableCellContentBlock(params) {
  const { schema, cellNode, createId = generateBlockId } = params;
  const contentBlockType = schema?.nodes?.[TABLE_CELL_CONTENT_BLOCK];

  if (!contentBlockType || !isTableCellNode(cellNode)) {
    return null;
  }

  if (cellNode.childCount === 0) {
    return {
      contentBlock: createEmptyContentBlock(schema, createId),
      reason: 'empty-cell',
    };
  }

  const children = [];
  let allChildrenAreContentBlocks = true;

  cellNode.forEach((childNode) => {
    children.push(childNode);
    if (!isTableCellContentBlock(childNode)) {
      allChildrenAreContentBlocks = false;
    }
  });

  if (allChildrenAreContentBlocks && children.length === 1) {
    const onlyChild = children[0];
    if (!needsContentBlockAttrNormalization(onlyChild)) {
      return null;
    }

    return {
      contentBlock: contentBlockType.create(
        normalizeContentBlockAttrs(onlyChild, createId),
        onlyChild.content
      ),
      reason: 'content-block-attrs',
    };
  }

  if (allChildrenAreContentBlocks) {
    const aggregatedContentBlock = createAggregatedTableCellContentBlock({
      schema,
      cellNode,
      createId,
    });

    return aggregatedContentBlock
      ? { contentBlock: aggregatedContentBlock, reason: 'multiple-content-blocks' }
      : null;
  }

  return {
    contentBlock: createWrappedContentBlock({ schema, cellNode, createId }),
    reason: 'wrapped-non-content-children',
  };
}

export function collectTableCellContentNormalizationTargets(state, options = {}) {
  const targets = [];
  const { createId = generateBlockId } = options;

  state.doc.descendants((node, pos) => {
    const normalized = createNormalizedTableCellContentBlock({
      schema: state.schema,
      cellNode: node,
      createId,
    });

    if (normalized) {
      targets.push({
        pos,
        cellNode: node,
        contentBlock: normalized.contentBlock,
        reason: normalized.reason,
      });
    }

    return true;
  });

  return targets;
}

export function buildTableCellContentNormalizationTransaction(state, options = {}) {
  const targets = collectTableCellContentNormalizationTargets(state, options);
  if (targets.length === 0) return null;

  const tr = state.tr;
  const metaKey = options.metaKey || DEFAULT_META_KEY;

  // 从后往前替换，避免同一事务内前面的 cell 变长/变短后影响后续位置。
  targets
    .slice()
    .sort((left, right) => right.pos - left.pos)
    .forEach(({ pos, cellNode, contentBlock }) => {
      const contentStartPos = pos + 1;
      const contentEndPos = contentStartPos + cellNode.content.size;
      tr.replaceWith(contentStartPos, contentEndPos, contentBlock);
    });

  tr.setMeta(metaKey, true);
  tr.setMeta('normalizedTableCellContentCount', targets.length);
  tr.setMeta('normalizedTableCellContentReasons', targets.map((target) => target.reason));

  return {
    tr,
    count: targets.length,
    reasons: targets.map((target) => target.reason),
  };
}

export function dispatchTableCellContentNormalization(editor, options = {}) {
  if (!editor?.state || !editor?.view?.dispatch) return false;

  const normalization = buildTableCellContentNormalizationTransaction(editor.state, options);
  if (!normalization) return false;

  editor.view.dispatch(normalization.tr);
  return true;
}

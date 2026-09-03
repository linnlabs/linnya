/**
 * tableCellContentAggregation.js
 *
 * 负责把合并单元格后产生的多个 tableCellContentBlock 聚合回一个内容块。
 *
 * 这里刻意不依赖 toolbar / Vue / DOM：
 * - ProseMirror 的 mergeCells 会把多个单元格的内容块直接搬进主单元格；
 * - Linnya 的语义期望是“一个单元格只有一个 tableCellContentBlock”；
 * - 虚拟化 hydrate/dehydrate 之后，命令层可能被重新触发，但文档结构规则必须保持一致。
 */

import { Fragment } from 'prosemirror-model';
import { generateBlockId } from '../../../../../shared/utils/idUtils';

const TABLE_CELL_NODE_NAMES = new Set(['tableCell', 'tableHeader']);
const TABLE_CELL_CONTENT_BLOCK = 'tableCellContentBlock';
const DEFAULT_META_KEY = 'aggregatedCellContent';

function isTableCellNode(node) {
  return Boolean(node && TABLE_CELL_NODE_NAMES.has(node.type?.name));
}

function isTableCellContentBlock(node) {
  return node?.type?.name === TABLE_CELL_CONTENT_BLOCK;
}

function shouldInsertBoundarySpace(aggregatedContent, nextContent) {
  if (aggregatedContent.size === 0 || nextContent.size === 0) return false;

  const lastChild = aggregatedContent.lastChild;
  const firstChild = nextContent.firstChild;

  if (lastChild?.isText && lastChild.text?.endsWith(' ')) return false;
  if (firstChild?.isText && firstChild.text?.startsWith(' ')) return false;

  return true;
}

export function appendTableCellContentWithBoundary(schema, aggregatedContent, nextContent) {
  if (shouldInsertBoundarySpace(aggregatedContent, nextContent)) {
    return aggregatedContent
      .append(Fragment.from(schema.text(' ')))
      .append(nextContent);
  }

  return aggregatedContent.append(nextContent);
}

export function createAggregatedTableCellContentBlock(params) {
  const { schema, cellNode, createId = generateBlockId } = params;
  const contentBlockType = schema?.nodes?.[TABLE_CELL_CONTENT_BLOCK];

  if (!contentBlockType || !isTableCellNode(cellNode) || cellNode.childCount <= 1) {
    return null;
  }

  const contentBlocks = [];
  let allChildrenAreContentBlocks = true;

  cellNode.forEach((childNode) => {
    if (!isTableCellContentBlock(childNode)) {
      allChildrenAreContentBlocks = false;
      return;
    }
    contentBlocks.push(childNode);
  });

  if (!allChildrenAreContentBlocks || contentBlocks.length <= 1) {
    return null;
  }

  let aggregatedContent = Fragment.empty;
  contentBlocks.forEach((contentBlockNode) => {
    aggregatedContent = appendTableCellContentWithBoundary(
      schema,
      aggregatedContent,
      contentBlockNode.content
    );
  });

  return contentBlockType.create(
    { id: createId(), blockType: 'tableCellContent' },
    aggregatedContent
  );
}

export function collectTableCellContentAggregationTargets(state, options = {}) {
  const targets = [];
  const { createId = generateBlockId } = options;

  state.doc.descendants((node, pos) => {
    const aggregatedContentBlock = createAggregatedTableCellContentBlock({
      schema: state.schema,
      cellNode: node,
      createId,
    });

    if (aggregatedContentBlock) {
      targets.push({
        pos,
        cellNode: node,
        aggregatedContentBlock,
      });
    }

    return true;
  });

  return targets;
}

export function buildTableCellContentAggregationTransaction(state, options = {}) {
  const targets = collectTableCellContentAggregationTargets(state, options);
  if (targets.length === 0) return null;

  const tr = state.tr;
  const metaKey = options.metaKey || DEFAULT_META_KEY;

  // 从后往前替换，避免前面的内容长度变化影响后续 cell 的原始位置。
  targets
    .slice()
    .sort((left, right) => right.pos - left.pos)
    .forEach(({ pos, cellNode, aggregatedContentBlock }) => {
      const contentStartPos = pos + 1;
      const contentEndPos = contentStartPos + cellNode.content.size;
      tr.replaceWith(contentStartPos, contentEndPos, aggregatedContentBlock);
    });

  tr.setMeta(metaKey, true);
  tr.setMeta('aggregatedCellContentCount', targets.length);

  return {
    tr,
    count: targets.length,
  };
}

export function dispatchTableCellContentAggregation(editor, options = {}) {
  if (!editor?.state || !editor?.view?.dispatch) return false;

  const aggregation = buildTableCellContentAggregationTransaction(editor.state, options);
  if (!aggregation) return false;

  editor.view.dispatch(aggregation.tr);
  return true;
}

import type { MarkdownDocJson, ProseMirrorJsonNode } from '../../normalization/runtime';

/**
 * 计算产品统计口径中的文本单位数：中文按汉字，英文按单词。
 * 标点、数字和仅用于结构表达的节点不参与统计。
 */
export function countMarkdownTextUnits(document: MarkdownDocJson): number {
  let total = 0;

  const visit = (node: ProseMirrorJsonNode): void => {
    if (typeof node.text === 'string') {
      total += countTextUnits(node.text);
    }

    for (const child of node.content ?? []) {
      visit(child);
    }
  };

  visit(document);
  return total;
}

function countTextUnits(text: string): number {
  const chineseCount = text.match(/[\u4E00-\u9FFF]/g)?.length ?? 0;
  const englishWordCount = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.length ?? 0;
  return chineseCount + englishWordCount;
}

import type { WebReadReliabilityCase } from './read-cases';

export interface ReadQualityResult {
  success: boolean;
  /** 标题、长度和关键内容满足要求；不把纯文本抽取的结构损失算成网络不可用。 */
  contentAvailable: boolean;
  hasTitle: boolean;
  charCount: number;
  codeBlockPreserved: boolean;
  tablePreserved: boolean;
  failureKind?: 'missing_title' | 'content_too_short' | 'expected_content_missing' | 'code_block_lost' | 'table_lost';
}

export function evaluateReadQuality(
  caseDefinition: WebReadReliabilityCase,
  result: { title: string; content: string },
): ReadQualityResult {
  const hasTitle = result.title.trim().length > 0;
  const charCount = result.content.length;
  const codeBlockPreserved = /```[\s\S]*?```/.test(result.content) || /(^|\n) {4}\S/.test(result.content);
  const tablePreserved = /\|[^\n]+\|\n\|(?:\s*:?-+:?\s*\|)+/.test(result.content) || /<table[\s>]/i.test(result.content);
  const normalizedText = `${result.title}\n${result.content}`.toLocaleLowerCase();
  const expectedContentFound = caseDefinition.expectedAnyKeywords.some((keyword) =>
    normalizedText.includes(keyword.toLocaleLowerCase()),
  );

  const failureKind = !hasTitle
    ? 'missing_title'
    : charCount < caseDefinition.minChars
      ? 'content_too_short'
      : !expectedContentFound
        ? 'expected_content_missing'
        : caseDefinition.expectCodeBlock && !codeBlockPreserved
          ? 'code_block_lost'
          : caseDefinition.expectTable && !tablePreserved
            ? 'table_lost'
            : undefined;
  const contentAvailable = hasTitle
    && charCount >= caseDefinition.minChars
    && expectedContentFound;

  return {
    success: failureKind === undefined,
    contentAvailable,
    hasTitle,
    charCount,
    codeBlockPreserved,
    tablePreserved,
    ...(failureKind ? { failureKind } : {}),
  };
}

import type { WebReadReliabilityCase } from './read-cases';
import { checkWebContentAssertions, type WebContentCheckResult } from './read-content-assertions';

export interface ReadQualityResult {
  success: boolean;
  /** 标题、长度和关键内容满足要求；不把纯文本抽取的结构损失算成网络不可用。 */
  contentAvailable: boolean;
  hasTitle: boolean;
  charCount: number;
  codeBlockMarkupPresent: boolean;
  tableMarkupPresent: boolean;
  /** checked=0 表示没有内容级核验，不能解释为核验通过。 */
  contentChecks: WebContentCheckResult;
  failureKind?: 'missing_title' | 'content_too_short' | 'expected_content_missing' | 'code_block_lost' | 'table_lost' | 'content_assertion_failed';
}

export function evaluateReadQuality(
  caseDefinition: WebReadReliabilityCase,
  result: { title: string; content: string },
): ReadQualityResult {
  const hasTitle = result.title.trim().length > 0;
  const charCount = result.content.length;
  const codeBlockMarkupPresent = /```[\s\S]*?```/.test(result.content) || /(^|\n) {4}\S/.test(result.content);
  const tableMarkupPresent = /\|[^\n]+\|\n\|(?:\s*:?-+:?\s*\|)+/.test(result.content) || /<table[\s>]/i.test(result.content);
  const contentChecks = checkWebContentAssertions(result.content, caseDefinition.contentAssertions ?? []);
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
        : caseDefinition.expectCodeBlock && !codeBlockMarkupPresent
          ? 'code_block_lost'
          : caseDefinition.expectTable && !tableMarkupPresent
            ? 'table_lost'
            : contentChecks.failed.length > 0 ? 'content_assertion_failed' : undefined;
  const contentAvailable = hasTitle
    && charCount >= caseDefinition.minChars
    && expectedContentFound;

  return {
    success: failureKind === undefined,
    contentAvailable,
    hasTitle,
    charCount,
    codeBlockMarkupPresent,
    tableMarkupPresent,
    contentChecks,
    ...(failureKind ? { failureKind } : {}),
  };
}

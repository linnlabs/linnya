import type { WebReadExpectedOutcome, WebReadReliabilityCase } from './read-cases';
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
  failureKind?:
    | 'missing_title'
    | 'content_too_short'
    | 'expected_content_missing'
    | 'code_block_lost'
    | 'table_lost'
    | 'content_assertion_failed'
    | 'expected_resources_missing'
    | 'expected_blocked_not_returned';
}

export function resolveExpectedOutcome(
  caseDefinition: WebReadReliabilityCase,
): WebReadExpectedOutcome {
  if (caseDefinition.expectedOutcome) return caseDefinition.expectedOutcome;
  return caseDefinition.expectedFailureKind !== undefined ? 'blocked' : 'content';
}

export function matchesExpectedFailureKind(
  expected: WebReadReliabilityCase['expectedFailureKind'],
  actual: string | undefined,
  code?: string,
): boolean {
  if (!expected) return false;
  const accepted = Array.isArray(expected) ? expected : [expected];
  return (actual !== undefined && accepted.includes(actual))
    || (code !== undefined && accepted.includes(code));
}

export function evaluateReadQuality(
  caseDefinition: WebReadReliabilityCase,
  result: {
    title: string;
    content: string;
    resourcesCount?: number;
    warnings?: readonly string[];
  },
): ReadQualityResult {
  const expectedOutcome = resolveExpectedOutcome(caseDefinition);
  const hasTitle = result.title.trim().length > 0;
  const charCount = result.content.length;
  const codeBlockMarkupPresent = /```[\s\S]*?```/.test(result.content) || /(^|\n) {4}\S/.test(result.content);
  const tableMarkupPresent = /\|[^\n]+\|\n\|(?:\s*:?-+:?\s*\|)+/.test(result.content) || /<table[\s>]/i.test(result.content);
  const contentChecks = checkWebContentAssertions(result.content, caseDefinition.contentAssertions ?? []);

  if (expectedOutcome === 'blocked') {
    return {
      success: false,
      contentAvailable: false,
      hasTitle,
      charCount,
      codeBlockMarkupPresent,
      tableMarkupPresent,
      contentChecks,
      failureKind: 'expected_blocked_not_returned',
    };
  }

  if (expectedOutcome === 'resources_only') {
    const hasResources = (result.resourcesCount ?? 0) > 0;
    const failureKind = !hasTitle
      ? 'missing_title'
      : !hasResources
        ? 'expected_resources_missing'
        : contentChecks.failed.length > 0 ? 'content_assertion_failed' : undefined;
    return {
      success: failureKind === undefined,
      contentAvailable: hasTitle && hasResources,
      hasTitle,
      charCount,
      codeBlockMarkupPresent,
      tableMarkupPresent,
      contentChecks,
      ...(failureKind ? { failureKind } : {}),
    };
  }

  const normalizedText = `${result.title}\n${result.content}`.toLocaleLowerCase();
  const expectedContentFound = caseDefinition.expectedAnyKeywords.length === 0
    || caseDefinition.expectedAnyKeywords.some((keyword) =>
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

export function assertExpectedMarkdownDocumentVersion(params: {
  readonly expected: number;
  readonly actual: number;
}): void {
  if (params.actual !== params.expected) {
    throw new Error(
      `文档版本冲突: expected=${params.expected}, actual=${params.actual}`,
    );
  }
}

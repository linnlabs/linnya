import { MarkdownFileWriteConflictError } from '../definitions/markdownDocumentWrite';

/** 待确认修订与批注同样属于 current text，不能只比较正文版本号。 */
export function assertMarkdownWriteSourceCurrent(
  expectedCurrentText: string | undefined,
  currentText: string,
): void {
  if (expectedCurrentText !== undefined && expectedCurrentText !== currentText) {
    throw new MarkdownFileWriteConflictError();
  }
}

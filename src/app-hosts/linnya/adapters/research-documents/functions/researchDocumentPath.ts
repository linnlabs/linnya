import { parseFileLocator } from '@app/schemas';
import { ResearchDocumentError } from '../../../application/research/definitions/researchDocumentPort';

export function researchDocumentPath(locator: string): string {
  const parsed = parseFileLocator(locator);
  if (parsed.kind !== 'workspace') {
    throw new ResearchDocumentError('RESEARCH_DOCUMENT_PATH_INVALID', '研究文档必须使用 workspace:/... 路径。');
  }
  return parsed.path;
}

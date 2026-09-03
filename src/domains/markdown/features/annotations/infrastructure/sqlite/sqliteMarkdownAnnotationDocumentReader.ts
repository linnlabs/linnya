import type { MarkdownSqliteReadSource } from '../../../../definitions/markdownReadDatabase';
import { createMarkdownReadDatabase } from '../../../../infrastructure/sqlite/markdownReadDatabaseAdapter';
import { MarkdownDocumentVersionReader } from '../../../document-storage';
import {
  assertMarkdownDocumentBlockIdentities,
  parseMarkdownDocJson,
  type MarkdownDocJson,
} from '../../../normalization';
import type { MarkdownAnnotationDocumentReader } from '../../definitions/markdownAnnotation';

/** 批注用例的最小正文读取 adapter；不装配完整 MarkdownDocumentService facade。 */
export class SqliteMarkdownAnnotationDocumentReader implements MarkdownAnnotationDocumentReader {
  private readonly versionReader: MarkdownDocumentVersionReader;

  constructor(source: MarkdownSqliteReadSource) {
    this.versionReader = new MarkdownDocumentVersionReader(createMarkdownReadDatabase(source));
  }

  getDocument(documentNodeId: string): MarkdownDocJson {
    const version = this.versionReader.getLatest(documentNodeId);
    if (!version) {
      throw new Error(`Markdown document not found: ${documentNodeId}`);
    }
    const document = parseMarkdownDocJson(JSON.parse(version.content_json));
    assertMarkdownDocumentBlockIdentities(document);
    return document;
  }
}

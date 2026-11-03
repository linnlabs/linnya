import type { PluginSqliteDatabaseLike } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import type { DocumentPreviewCapability } from '@linnya/plugin-host-contract/backend/documentPreview';
import { readMarkdownVfsContent } from '../document-read';
import { createHash } from 'node:crypto';
import { createMarkdownReadDatabase } from '../../infrastructure/sqlite/markdownReadDatabaseAdapter';
import { createMarkdownCover } from './functions/createMarkdownCover';

/** 只读正文投影；不创建 Editor、修订提议或第二个可写正文。 */
export function createMarkdownPreviewCapability(db: PluginSqliteDatabaseLike): DocumentPreviewCapability {
  function load(documentId: string) {
    const content = readMarkdownVfsContent({ db: createMarkdownReadDatabase(db), documentId });
    if (!content) throw new Error('Markdown preview source not found');
    const revisionKey = createHash('sha256').update(JSON.stringify([content.metadata?.versionId, content.text])).digest('hex');
    return { content, revisionKey };
  }
  return {
    getRevision: input => load(input.documentId).revisionKey,
    render(input) {
      const { content, revisionKey } = load(input.documentId);
      return { revisionKey, summary: content.text.slice(0, 4000), image: createMarkdownCover(content.text, input.widthPx), detail: { format: 'markdown', text: content.text.slice(0, 1_000_000) } };
    },
  };
}

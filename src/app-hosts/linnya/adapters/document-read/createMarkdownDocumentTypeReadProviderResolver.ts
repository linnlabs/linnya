import type Database from 'better-sqlite3';
import {
  createMarkdownReadDatabase,
  MarkdownDocumentService,
  MarkdownNormalizationService,
  readMarkdownDocumentView,
} from '../../../../domains/markdown';
import type {
  WorkspaceDocumentTypeReadProviderResolver,
} from '../../../../features/workspace/document-read/definitions/workspaceDocumentRead';
import { buildDocumentCitationWindowOutput } from '../../../../features/workspace/document-read/orchestration/buildDocumentCitationWindowOutput';

/** 永久内建 Markdown DocumentView provider；不进入插件注册或 ToolContext。 */
export function createMarkdownDocumentTypeReadProviderResolver(params: {
  readonly db: Database.Database;
}): WorkspaceDocumentTypeReadProviderResolver {
  const store = new MarkdownDocumentService(params.db);
  const normalizer = new MarkdownNormalizationService(params.db, store);
  const readDb = createMarkdownReadDatabase(params.db);
  return (documentType) => (
    documentType === 'document' || documentType === 'markdown'
      ? {
          displayName: 'Markdown',
          enabled: true,
          disabledMessage: 'Markdown 是永久启用的内建文档类型。',
          read: async request => {
            const projection = await readMarkdownDocumentView({
              request,
              readDb,
              store,
              normalizer,
            });
            const citationWindow = projection.citationWindow
              ? buildDocumentCitationWindowOutput(projection.citationWindow)
              : null;
            return {
              data: projection.data,
              observation: [
                projection.primaryObservation,
                citationWindow?.observationSuffix ?? '',
                ...projection.trailingObservations,
              ].filter(section => section.length > 0).join('\n\n'),
              ...(citationWindow
                ? {
                    citationSources: [...citationWindow.citationSources],
                    citationDiagnostics: [...citationWindow.citationDiagnostics],
                  }
                : {}),
            };
          },
        }
      : undefined
  );
}

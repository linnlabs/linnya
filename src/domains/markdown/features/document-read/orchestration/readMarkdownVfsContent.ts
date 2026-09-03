import type { MarkdownReadDatabase } from '../../../definitions/markdownReadDatabase';
import { MarkdownDocumentVersionReader } from '../../document-storage';
import { MarkdownPendingRevisionReader } from '../../pending-revisions';
import { parseMarkdownDocJson } from '../../normalization';
import { serializeMarkdownBlocks } from '../../../shared/markdownBlockProjection';
import type { MarkdownVfsContent } from '../definitions/markdownVfsContent';
import { buildMarkdownCitationReadProjection } from './buildMarkdownCitationReadProjection';

/**
 * 读取 Markdown 文档实体的 current 文本投影。
 *
 * 这里只认识 Markdown 表与文档内部结构，不解析 Workspace path，也不截断正文；路径解析和最终字符窗口
 * 仍由 Workspace VFS 拥有。损坏的持久化结构必须显式失败，不能伪装成空文件。
 */
export function readMarkdownVfsContent(params: {
  readonly db: MarkdownReadDatabase;
  readonly documentId: string;
}): MarkdownVfsContent | null {
  const version = new MarkdownDocumentVersionReader(params.db).getLatest(params.documentId);
  if (!version) return null;

  const parsed: unknown = JSON.parse(version.content_json);
  const content = parseMarkdownDocJson(parsed);
  const pendings = new MarkdownPendingRevisionReader(params.db)
    .getPendingRevisions(params.documentId);
  const currentView = buildMarkdownCitationReadProjection({
    content,
    pendings,
    viewMode: 'preview',
  });

  return {
    contentType: 'text/markdown',
    text: serializeMarkdownBlocks(currentView.viewBlocks),
    metadata: {
      versionNumber: version.version_number,
      versionId: version.id,
      view: 'current',
      pendingCount: pendings.length,
    },
    citationProjection: currentView.citationProjection,
  };
}

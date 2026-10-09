import type Database from 'better-sqlite3';
import { createMarkdownReadDatabase, readMarkdownVfsContent } from 'src/domains/markdown';
import { readPersistedWorkspaceVfsNode } from 'src/features/workspace/vfs';
import { projectResearchDocumentSnapshot } from './projectResearchDocumentSnapshot';

/** 创建 provider 的同步事务内回读；不能 await VFS 路由后才补交 receipt。 */
export function readCreatedResearchDocumentSnapshot(db: Database.Database, documentId: string, maxChars: number) {
  const node = readPersistedWorkspaceVfsNode(db, documentId);
  const content = readMarkdownVfsContent({ db: createMarkdownReadDatabase(db), documentId });
  if (!node || !content) throw new Error('Research document creation returned no committed Markdown identity.');
  return projectResearchDocumentSnapshot({ ok: true, node, ...content, truncated: content.text.length > maxChars });
}

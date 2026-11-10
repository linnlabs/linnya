import type Database from 'better-sqlite3';
import { createDocumentReferenceOperations } from 'src/domains/document-references';
import { createSqliteSemanticLayer, SemanticLayerError } from 'src/domains/semantic-layer';
import { readWorkspaceDocumentIdentity } from 'src/features/workspace/infrastructure/sqlite/workspaceDocumentProjection';
import { formatDocumentPropertySection } from '../functions/documentPropertySection';

/**
 * 当前项目里一份文档的属性段；没有可显示的内容，或节点不是本项目的普通文档（系统视图、回收站、文件夹）时为空。
 * 读写两侧用同一份结果判断 Agent 是否把属性段原样带回。
 */
export function readDocumentPropertySection(db: Database.Database, projectId: string, documentId: string): string | null {
  const nodes = { read: (id: string) => readWorkspaceDocumentIdentity(db, id) };
  let state;
  try {
    state = createSqliteSemanticLayer(db, nodes).readObject(projectId, { kind: 'document', id: documentId });
  } catch (error) {
    if (error instanceof SemanticLayerError) return null;
    throw error;
  }
  const sources = new Set(createDocumentReferenceOperations(db, nodes).listBacklinks(documentId).map(link => link.sourceDocumentId));
  return formatDocumentPropertySection({ state, backlinkCount: sources.size });
}

import { resolveWorkspaceDocumentPath } from '@plugin/backend/workspaceDocumentProjection';
import { CanvasCliFailure, type CanvasCliCommand } from '../features/canvasCli';
import { readCanvasSnapshot } from '../features/canvasCommit';
import { readCanvasProjectionContext, readCanvasDocumentIdentity } from '../features/canvasDocument';
import { queryCanvas, checkCanvas } from '../features/canvasQuery';
import type Database from 'better-sqlite3';

/** 不创建文档运行态、不迁移、不启动历史清理或Asset owner；复用唯一只读查询规则。 */
export function readCanvasStandalone(database: Database.Database, projectId: string, command: Extract<CanvasCliCommand, { kind: 'read' | 'show' | 'find' | 'neighbors' | 'region' | 'check' }>) {
  return database.transaction(() => {
    const node = resolveWorkspaceDocumentPath(database, { projectId, path: command.path });
    if (!node) throw new CanvasCliFailure('document_missing', '画布路径不存在或不在指定项目。');
    readCanvasDocumentIdentity(database, node.id, projectId);
    const snapshot = readCanvasSnapshot(database, node.id);
    return command.kind === 'check' ? checkCanvas(snapshot) : queryCanvas(snapshot, readCanvasProjectionContext(database, snapshot), command);
  }).deferred();
}

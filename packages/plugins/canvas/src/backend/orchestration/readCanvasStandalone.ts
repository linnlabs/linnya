import { resolveWorkspaceDocumentPath } from '@plugin/backend/workspaceDocumentProjection';
import { CanvasCliFailure, type CanvasStandaloneReadCommand } from '../features/canvasCli';
import { readCanvasAgentRequestStatus, projectCanvasAgentReceiptQuery } from '../features/agentChanges/queries';
import { readCanvasSnapshot } from '../features/canvasCommit';
import { readCanvasProjectionContext, readCanvasDocumentIdentity } from '../features/canvasDocument';
import { queryCanvas, checkCanvas } from '../features/canvasQuery';
import type Database from 'better-sqlite3';

/** 不创建文档运行态、不迁移、不启动历史清理或Asset owner；复用唯一只读查询规则。 */
export function readCanvasStandalone(database: Database.Database, projectId: string, command: CanvasStandaloneReadCommand) {
  return database.transaction(() => {
    const node = resolveWorkspaceDocumentPath(database, { projectId, path: command.path });
    if (!node) throw new CanvasCliFailure('document_missing', '画布路径不存在或不在指定项目。');
    readCanvasDocumentIdentity(database, node.id, projectId);
    if (command.kind === 'receipt') return projectCanvasAgentReceiptQuery(command.path, readCanvasAgentRequestStatus(database, node.id, JSON.stringify(['agent', command.conversationId]), command.requestId));
    const snapshot = readCanvasSnapshot(database, node.id);
    return command.kind === 'check' ? checkCanvas(snapshot) : queryCanvas(snapshot, readCanvasProjectionContext(database, snapshot), command);
  }).deferred();
}

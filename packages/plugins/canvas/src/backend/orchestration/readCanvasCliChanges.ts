import { CanvasCliFailure, type CanvasCliCommand } from '../features/canvasCli';
import {
  CANVAS_CHANGE_LOG_LIMIT,
  readCanvasChangeLog,
  readCanvasChangeLogStart,
  readCanvasSequenceBefore,
  readCanvasSnapshot,
} from '../features/canvasCommit';
import { readCanvasProjectionContext } from '../features/canvasDocument';
import { queryCanvasChanges } from '../features/canvasQuery';
import { projectCanvasCliSnapshot } from './projectCanvasCliSnapshot';
import type { CanvasCliScope, CanvasCliServices } from './definitions/canvasCliExecution';

/**
 * 读同一份有界变化日志，范围早于保留窗口时如实标为不完整。
 * 当前元素经 CLI 读投影登记读基线；已删除元素的文档引用仍按当前项目权限解析。
 */
export function readCanvasCliChanges(
  command: Extract<CanvasCliCommand, { kind: 'changes' }>,
  scope: CanvasCliScope,
  services: CanvasCliServices
) {
  const { database, documentId } = scope;
  return database
    .transaction(() => {
      const snapshot = readCanvasSnapshot(database, documentId);
      if (command.after !== undefined && command.after > snapshot.sequence)
        throw new CanvasCliFailure(
          'invalid_sequence',
          `--after 超过当前提交序号 ${snapshot.sequence}。`
        );
      const start = readCanvasChangeLogStart(database, documentId);
      const afterSequence =
        command.after ??
        readCanvasSequenceBefore(database, { documentId, since: command.since ?? 0 }) ??
        snapshot.sequence;
      // 日志只保留最近一段；按时间查时，最早保留的那条若已在时点之后，更早被裁掉的也可能在。
      const complete =
        command.after !== undefined
          ? afterSequence >= snapshot.sequence - CANVAS_CHANGE_LOG_LIMIT
          : snapshot.sequence <= CANVAS_CHANGE_LOG_LIMIT ||
            start === null ||
            afterSequence + 1 > start.sequence;
      const commits = readCanvasChangeLog(database, { documentId, afterSequence });
      const projected = projectCanvasCliSnapshot(
        snapshot,
        services.referencesFor(database),
        scope.readerId
      );
      const removed = commits.flatMap(commit =>
        commit.changes.flatMap(change => (change.before ? [change.before] : []))
      );
      return queryCanvasChanges({
        snapshot: projected,
        context: readCanvasProjectionContext(database, {
          ...snapshot,
          elements: [...snapshot.elements, ...removed],
        }),
        commits,
        afterSequence,
        complete,
        currentConversationId: scope.context.conversationId ?? null,
      });
    })
    .immediate();
}

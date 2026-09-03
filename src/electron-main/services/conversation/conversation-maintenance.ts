/**
 * @file src/electron-main/services/conversation/conversation-maintenance.ts
 * @description 会话模块启动维护任务（一次性，不常驻）。
 *
 * 当前产品约束：
 * - `project_id IS NULL` 会话归属于 Linnya 助手；
 * - 启动维护不能清理这类会话，否则会造成用户的助手历史丢失。
 *
 * 注意：
 * - 该维护任务应由 `startupMaintenanceRunner.ts` 统一调度，避免散落在路由初始化逻辑中。
 * - UI read model rebuild 是同步 SQLite 工作；会话之间必须让出事件循环，避免启动期长时间占住主进程。
 */

import type { DatabaseService } from '../database';
import { Logger } from '../../../shared/logger';
import {
  findConversationsNeedingUiProjectionRebuild,
  rebuildConversationUiProjection,
} from '../../../app-hosts/linnya/adapters/persistence/event-store/ui-projection/rebuildConversation';

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

export async function runConversationMaintenanceOnce(databaseService: DatabaseService): Promise<void> {
  const logger = new Logger('ConversationMaintenance');

  try {
    const db = databaseService.getDb();
    const candidates = findConversationsNeedingUiProjectionRebuild(db);
    logger.info(
      `🧹 会话启动维护：UI read model 待重建会话数=${candidates.length}；保留无项目会话（project_id IS NULL），它们归属于 Linnya 助手`,
    );

    let rebuilt = 0;
    let skipped = 0;
    let maxConversationCostMs = 0;
    for (const candidate of candidates) {
      const result = rebuildConversationUiProjection(db, candidate.conversationId);
      if (result.status === 'rebuilt') {
        rebuilt += 1;
        maxConversationCostMs = Math.max(maxConversationCostMs, result.durationMs);
        logger.info(
          `UI read model 重建完成: conversationId=${result.conversationId}, events=${result.eventCount}, messages=${result.messageCount}, skippedEvents=${result.skippedEventCount}, sqlExcludedEvents=${result.sqlExcludedEventCount}, revision=${result.previousRevision}->${result.nextRevision}, costMs=${result.durationMs}`,
        );
      } else {
        skipped += 1;
        logger.info(
          `UI read model 跳过: conversationId=${result.conversationId}, reason=${result.reason}, costMs=${result.durationMs}`,
        );
      }
      await yieldToEventLoop();
    }

    logger.info(
      `✅ 会话启动维护完成: total=${candidates.length}, rebuilt=${rebuilt}, skipped=${skipped}, maxConversationCostMs=${maxConversationCostMs}`,
    );
  } catch (e) {
    logger.error(`❌ 启动维护：会话维护失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

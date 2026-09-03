import type {
  ExecutionAuditEventFact,
  ExecutionAuditEventPort,
} from 'src/app-hosts/linnya/application/execution-audit-export';
import type { IEventStore } from '../event-store/event-store.interface';

import { projectExecutionAuditEventFacts } from './functions/projectExecutionAuditEventFacts';

const EXECUTION_AUDIT_EVENT_PAGE_SIZE = 500;

/** 分页读取 EventStore 事实，避免长会话的审计查询一次性制造超大数据库结果集。 */
export function createEventStoreExecutionAuditEventPort(
  eventStore: Pick<IEventStore, 'readEvents'>,
): ExecutionAuditEventPort {
  return Object.freeze({
    async listByConversation(conversationId: string) {
      const facts: ExecutionAuditEventFact[] = [];
      let cursor: number | undefined;
      do {
        const page = await eventStore.readEvents(conversationId, {
          direction: 'forward',
          limit: EXECUTION_AUDIT_EVENT_PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        });
        for (const event of page.events) {
          facts.push(...projectExecutionAuditEventFacts(event));
        }
        if (!page.hasMore) return facts;
        if (page.nextCursor === undefined) {
          throw new Error('[ExecutionAudit] EventStore 分页声明 hasMore 但没有 nextCursor。');
        }
        cursor = page.nextCursor;
      } while (true);
    },
  });
}

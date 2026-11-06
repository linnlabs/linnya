import { parseRoutedRuntimeEvent, type RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { DatabaseService } from 'src/electron-main/services/database';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import { readTail } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection';
import { SqliteSubrunTraceHistoryProjector } from 'src/app-hosts/linnya/adapters/persistence/subrun-trace-history/sqliteSubrunTraceHistoryProjector';
import { mapUiMessageDtoToConversationMessage } from '../../../message-window/functions/mapUiMessageDto';

/** 回放夹具经正式事务先写事实再投影，工具卡与子运行详情都从真实存储读取。 */
export async function readPersistedResearchCards(conversationId: string, runId: string, events: readonly RuntimeEvent[]) {
  const service = new DatabaseService(':memory:');
  service.initialize();
  try {
    const db = service.getDb();
    const store = new SQLiteEventStore(db);
    await store.ensureConversation(conversationId, [], undefined, 'agent');
    const session = await store.beginRunSession(conversationId, runId, { kind: 'agent' });
    const traces = new SqliteSubrunTraceHistoryProjector(db);
    for (const event of events) {
      if (event.type === 'subrun_trace') traces.project(event);
      else await store.appendEventToRun(session, parseRoutedRuntimeEvent(event));
    }
    const page = readTail(db, conversationId, 10);
    if (page.status !== 'ready') throw new Error('Expected durable research cards');
    return page.messages.map(message => {
      const card = mapUiMessageDtoToConversationMessage(message);
      if (card.type !== 'tool_calls') throw new Error('Expected a research tool card');
      return card;
    });
  } finally {
    service.close();
  }
}

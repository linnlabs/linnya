import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { PromptKeys } from '@app/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type RuntimeEvent,
  RunIdSchema,
} from '@linnlabs/linnkit/contracts';
import { execution, graph } from '@linnlabs/linnkit/runtime-kernel';
import {
  createGraphLoopHarness,
  createScriptedInferenceHarness,
  createToolContextFixture,
} from '@linnlabs/linnkit/testkit';

import { createDefaultLlmNode } from 'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import { defaultObservationPreviewPort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { LinnyaEventStoreAdapter } from 'src/app-hosts/linnya/adapters/persistence/event-store/linnkit-event-store.adapter';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import { readTail } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteUiMessagesReader';
import { parseStoredRuntimeEvent } from 'src/app-hosts/linnya/adapters/persistence/event-store/functions/runtimeEventStorageCodec';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import { createScriptedChatModelCatalog } from '../modelCatalogHarness';
import { createToolRuntimeHarness } from '../toolRegistryHarness';

interface Latch {
  readonly promise: Promise<void>;
  release(): void;
}

function createLatch(): Latch {
  let release = (): void => {
    throw new Error('latch was released before initialization');
  };
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

class CancelDuringFirstTool extends BaseTool {
  readonly name = 'cancel_after_first';
  readonly description = '第一个串行调用执行中等待用户取消。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      ordinal: { type: 'number', description: '调用顺序。' },
    },
    required: ['ordinal'],
  };

  constructor(private readonly executionStarted: Latch) {
    super();
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (args.ordinal === 1) {
      const signal = context.abortSignal;
      if (!signal) {
        throw new Error('tool execution must receive the run abort signal');
      }
      this.executionStarted.release();
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            const error = new Error('The user aborted a request.');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true }
        );
      });
    }
    return JSON.stringify({
      data: { ordinal: args.ordinal },
      observation: `completed call ${String(args.ordinal)}`,
    });
  }
}

function createWorkspaceDatabase(databasePath: string): Database.Database {
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE assets (id TEXT PRIMARY KEY);
  `);
  for (const schema of CONVERSATION_SCHEMAS) {
    db.exec(schema);
  }
  return db;
}

function readPersistedEvents(db: Database.Database, conversationId: string): RuntimeEvent[] {
  const rows = db
    .prepare<unknown[], {
      id: string;
      type: string;
      payload: string;
      ts: number;
      run_id: string;
      parent_run_id: string | null;
    }>(
      `
    SELECT e.id, e.type, e.payload, e.ts, e.run_id, r.parent_run_id
    FROM events e
    JOIN runs r ON r.id = e.run_id
    WHERE r.conversation_id = ?
    ORDER BY e.rowid ASC
  `
    )
    .all(conversationId);
  return rows.map(row => parseStoredRuntimeEvent(row.payload, {
    eventId: row.id,
    eventType: row.type,
    conversationId,
    runId: row.run_id,
    parentRunId: row.parent_run_id,
    timestamp: row.ts,
  }));
}

describe('cancelled serial tool batch SQLite recovery', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map(directory => fsp.rm(directory, { recursive: true, force: true }))
    );
  });

  it('取消首个正在执行的调用后，当前与未启动调用都必须有终态配对且重载后不再 loading', async () => {
    const temporaryDirectory = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-cancelled-tool-batch-')
    );
    temporaryDirectories.push(temporaryDirectory);
    const databasePath = path.join(temporaryDirectory, 'workspace.sqlite');
    const conversationId = 'conversation-cancelled-tool-batch';
    const runId = 'run-cancelled-tool-batch';
    const turnId = 'turn-cancelled-tool-batch';
    const firstToolCallId = 'call-cancelled-tool-batch-first';
    const secondToolCallId = 'call-cancelled-tool-batch-second';
    const controller = new AbortController();
    const executionStarted = createLatch();
    const db = createWorkspaceDatabase(databasePath);
    const hostStore = new SQLiteEventStore(db);
    await hostStore.ensureConversation(conversationId, [], undefined, 'agent');
    await hostStore.beginRunSession(conversationId, runId, { kind: 'agent' });

    const eventStore = new LinnyaEventStoreAdapter(db, hostStore);
    const sequencer = new execution.EventSequencer(conversationId);
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse(runId),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const persistence = new execution.EventBusEventPersistence({
      eventBus,
      eventStore,
      nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
    });
    persistence.connect();

    const aiHarness = createScriptedInferenceHarness([
      {
        contentChunks: ['我会依次处理两个子任务。'],
        toolCalls: [
          {
            id: firstToolCallId,
            name: 'cancel_after_first',
            argumentsJson: JSON.stringify({ ordinal: 1 }),
          },
          {
            id: secondToolCallId,
            name: 'cancel_after_first',
            argumentsJson: JSON.stringify({ ordinal: 2 }),
          },
        ],
      },
    ]);
    const toolHarness = createToolRuntimeHarness([new CancelDuringFirstTool(executionStarted)]);
    const modelCatalog = createScriptedChatModelCatalog();
    const toolContext = createToolContextFixture({
      conversationId,
      turnId,
      historyEvents: [],
      patch: { abortSignal: controller.signal },
    });
    const harness = createGraphLoopHarness({
      conversationId,
      turnId,
      query: '依次执行两个子任务，执行中我可能取消。',
      request: {
        query: '依次执行两个子任务，执行中我可能取消。',
        promptKey: PromptKeys.DEFAULT,
        model_id: 'scripted-test-model',
        enableTools: true,
        availableTools: ['cancel_after_first'],
      },
      toolContext,
      llmCaller: aiHarness.getLlmCaller(),
      toolRuntime: toolHarness.toolRuntime,
      observationPreview: defaultObservationPreviewPort,
      createLlmNode: ({ llmCaller, toolRuntime }) =>
        createDefaultLlmNode({
          llmCaller,
          toolRuntime,
          modelCatalog,
        }),
      maxSteps: 8,
      signal: controller.signal,
      runtimeEventSink: (event, source) => publisher.publish(event, source),
    });

    try {
      const execution = harness.run();
      await executionStarted.promise;
      controller.abort('user cancelled the foreground run');
      await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
      await persistence.drain();
      expect(
        toolHarness.getExecutions().map(executionRecord => executionRecord.args.ordinal)
      ).toEqual([1]);
    } finally {
      eventBus.close();
      toolHarness.restore();
      hostStore.close();
    }

    const reopenedDb = new Database(databasePath);
    try {
      const events = readPersistedEvents(reopenedDb, conversationId);
      const decision = events.find(event => event.type === 'tool_call_decision');
      expect(decision).toMatchObject({
        type: 'tool_call_decision',
        tool_call_id: firstToolCallId,
      });
      const outputIds = events
        .filter(
          (event): event is Extract<RuntimeEvent, { type: 'tool_output' }> =>
            event.type === 'tool_output'
        )
        .map(event => event.tool_call_id);
      expect(outputIds).toEqual([firstToolCallId, secondToolCallId]);
      expect(
        events
          .filter(
            (event): event is Extract<RuntimeEvent, { type: 'tool_output' }> =>
              event.type === 'tool_output'
          )
          .map(event => event.status)
      ).toEqual(['error', 'error']);

      const history = readTail(reopenedDb, conversationId, 50);
      expect(history.status).toBe('ready');
      if (history.status !== 'ready') {
        throw new Error('history projection must be ready after current-version writes');
      }
      const tools = history.messages.filter(message => message.message_type === 'tool_calls');
      expect(tools).toHaveLength(2);
      expect(tools.map(message => message.payload?.status)).toEqual(['error', 'error']);
      expect(tools.every(message => message.payload?.completed_at !== undefined)).toBe(true);
    } finally {
      reopenedDb.close();
    }
  });
});

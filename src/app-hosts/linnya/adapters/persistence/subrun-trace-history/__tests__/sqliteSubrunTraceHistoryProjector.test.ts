import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createSubRunTraceEvent,
  RunIdSchema,
  ToolCallIdSchema,
  type SubRunTraceEvent,
  type RuntimeResourceRef,
} from 'linnkit/contracts';
import { CONVERSATION_SCHEMAS } from '../../event-store/conversation.schema';
import { readSubrunTrace } from '../../event-store/ui-projection/sqliteUiMessagesReader';
import { SqliteSubrunTraceHistoryProjector } from '../sqliteSubrunTraceHistoryProjector';
import { SqliteSubrunTraceHistoryCleanup } from '../sqliteSubrunTraceHistoryCleanup';

const imageRef: RuntimeResourceRef = {
  id: 'child-image-attachment',
  kind: 'image',
  resourceId: 'child-image-asset',
  mediaType: 'image/png',
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
  fileName: 'slide-001.png',
};

function createStore(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of CONVERSATION_SCHEMAS) db.exec(schema);
  db.prepare(
    `
    INSERT INTO conversations (
      conversation_id,
      created_at,
      last_event_at
    ) VALUES (?, ?, ?)
  `
  ).run('conversation-a', 1, 1);
  db.prepare(
    `
    INSERT INTO conversation_ui_projection_state (
      conversation_id,
      status,
      revision,
      rebuilt_at
    ) VALUES (?, 'ready', 0, ?)
  `
  ).run('conversation-a', 1);
  return db;
}

function createTrace(
  sourceEventId: string,
  kind: SubRunTraceEvent['kind'],
  overrides: Partial<SubRunTraceEvent> = {}
): SubRunTraceEvent {
  return createSubRunTraceEvent(
    `trace-${sourceEventId}`,
    overrides.conversation_id ?? 'conversation-a',
    overrides.turn_id ?? 'turn-a',
    ToolCallIdSchema.parse(overrides.parent_tool_call_id ?? 'parent-tool-a'),
    overrides.subrun_id ?? 'subrun-a',
    kind,
    {
      source_event_id: sourceEventId,
      timestamp: overrides.timestamp ?? 100,
      ...(overrides.run_id === undefined ? {} : { run_id: overrides.run_id }),
      ...(overrides.subrun_parent_id === undefined
        ? {}
        : { subrun_parent_id: overrides.subrun_parent_id }),
      ...(kind === 'thought_complete' ? { content: '完成分析' } : {}),
      ...(kind === 'tool_call_decision'
        ? {
            tool_calls: [
              {
                tool_name: 'search',
                tool_call_id: ToolCallIdSchema.parse('child-tool-a'),
                args: { query: 'storage' },
              },
            ],
          }
        : {}),
      ...(kind === 'tool_output'
        ? {
            tool_name: 'search',
            tool_call_id: ToolCallIdSchema.parse('child-tool-a'),
            status: 'success',
            output: { hits: 2 },
            ...(overrides.attachments === undefined
              ? {}
              : { attachments: overrides.attachments }),
          }
        : {}),
      ...(kind === 'final_answer'
        ? {
            answer_id: 'answer-a',
            content: '完成',
            completion_reason: 'terminal',
          }
        : {}),
      ...(kind === 'history_summary'
        ? {
            original_message_count: 4,
            replaced_message_ids: ['child-tool-output-1'],
            compression_ratio: 0.25,
            included_old_summary: false,
          }
        : {}),
    }
  );
}

describe('SqliteSubrunTraceHistoryProjector', () => {
  it('只保存语义项，不保存逐 chunk 与过程帧', () => {
    const db = createStore();
    const projector = new SqliteSubrunTraceHistoryProjector(db);

    projector.project(createTrace('thought-delta', 'thought_delta'));
    projector.project(createTrace('tool-process', 'tool_process'));
    projector.project(createTrace('answer-chunk', 'final_answer_chunk'));
    projector.project(createTrace('thought-complete', 'thought_complete'));
    projector.project(createTrace('tool-decision', 'tool_call_decision'));
    projector.project(createTrace('tool-output', 'tool_output'));
    projector.project(createTrace('final-answer', 'final_answer'));
    projector.project(createTrace('history-summary', 'history_summary'));

    const result = readSubrunTrace(db, 'conversation-a', 'parent-tool-a', 'subrun-a');
    expect(result.status).toBe('ready');
    expect(result.status === 'ready' ? result.events.map(event => event.kind) : []).toEqual([
      'thought_complete',
      'tool_call_decision',
      'tool_output',
      'final_answer',
      'history_summary',
    ]);
    expect(result.status === 'ready' ? result.events[2] : undefined).toMatchObject({
      source_event_id: 'tool-output',
      output: { hits: 2 },
      ephemeral: true,
    });
    expect(result.status === 'ready' ? result.events[1] : undefined).toMatchObject({
      kind: 'tool_call_decision',
      tool_calls: [
        {
          tool_call_id: 'child-tool-a',
          tool_name: 'search',
          args: { query: 'storage' },
        },
      ],
    });
    expect(result.status === 'ready' ? result.events[4] : undefined).toMatchObject({
      source_event_id: 'history-summary',
      original_message_count: 4,
      replaced_message_ids: ['child-tool-output-1'],
      compression_ratio: 0.25,
      included_old_summary: false,
    });

    db.close();
  });

  it('成功 tool_output 的附件顺序写入 JSON read model 并在重启读取边界恢复', () => {
    const db = createStore();
    const projector = new SqliteSubrunTraceHistoryProjector(db);
    const secondRef: RuntimeResourceRef = {
      ...imageRef,
      id: 'child-image-attachment-2',
      resourceId: 'child-image-asset-2',
      sha256: 'b'.repeat(64),
      fileName: 'slide-002.png',
    };
    projector.project(createTrace('tool-image-output', 'tool_output', {
      attachments: [imageRef, secondRef],
    }));

    const stored = db.prepare<[], { readonly payload_json: string }>(`
      SELECT payload_json
      FROM subrun_trace_items
      WHERE source_event_id = 'tool-image-output'
    `).get();
    expect(JSON.parse(stored?.payload_json ?? '{}')).toMatchObject({
      attachments: [imageRef, secondRef],
    });
    const result = readSubrunTrace(db, 'conversation-a', 'parent-tool-a', 'subrun-a');
    expect(result.status === 'ready' ? result.events[0] : undefined).toMatchObject({
      kind: 'tool_output',
      attachments: [imageRef, secondRef],
    });

    db.close();
  });

  it('拒绝同一 subrun 的不可变归属字段发生变化', () => {
    const db = createStore();
    db.prepare(
      `
      INSERT INTO conversations (conversation_id, created_at, last_event_at)
      VALUES (?, ?, ?)
    `
    ).run('conversation-b', 1, 1);
    const projector = new SqliteSubrunTraceHistoryProjector(db);
    projector.project(
      createTrace('first', 'thought_complete', {
        run_id: RunIdSchema.parse('parent-run-a'),
        subrun_parent_id: 'root-subrun-a',
      })
    );

    const conflicts: ReadonlyArray<readonly [string, Partial<SubRunTraceEvent>]> = [
      ['conversation', { conversation_id: 'conversation-b' }],
      ['turn', { turn_id: 'turn-b' }],
      ['parent run', { run_id: RunIdSchema.parse('parent-run-b') }],
      [
        'parent tool call',
        {
          parent_tool_call_id: ToolCallIdSchema.parse('parent-tool-b'),
        },
      ],
      ['subrun parent', { subrun_parent_id: 'root-subrun-b' }],
    ];

    for (const [label, overrides] of conflicts) {
      expect(
        () =>
          projector.project(
            createTrace(`conflict-${label}`, 'final_answer', {
              run_id: RunIdSchema.parse('parent-run-a'),
              subrun_parent_id: 'root-subrun-a',
              ...overrides,
            })
          ),
        label
      ).toThrow('不可变归属绑定冲突');
    }

    db.close();
  });

  it('source_event_id 在 read model 中保持全局唯一', () => {
    const db = createStore();
    const projector = new SqliteSubrunTraceHistoryProjector(db);
    projector.project(createTrace('same-source', 'thought_complete'));

    expect(() => projector.project(createTrace('same-source', 'final_answer'))).toThrow(
      'UNIQUE constraint failed'
    );

    db.close();
  });

  it('外键关闭时仍按 parent run 和 conversation 显式清理', () => {
    const db = createStore();
    db.pragma('foreign_keys = OFF');
    const projector = new SqliteSubrunTraceHistoryProjector(db);
    const cleanup = new SqliteSubrunTraceHistoryCleanup(db);
    projector.project(
      createTrace('source-a', 'thought_complete', {
        run_id: RunIdSchema.parse('parent-run-a'),
      })
    );
    projector.project(
      createTrace('source-b', 'final_answer', {
        run_id: RunIdSchema.parse('parent-run-b'),
        parent_tool_call_id: ToolCallIdSchema.parse('parent-tool-b'),
        subrun_id: 'subrun-b',
      })
    );

    cleanup.deleteForParentRunIds(['parent-run-a']);
    expect(readSubrunTrace(db, 'conversation-a', 'parent-tool-a', 'subrun-a')).toMatchObject({
      status: 'ready',
      events: [],
    });
    expect(readSubrunTrace(db, 'conversation-a', 'parent-tool-b', 'subrun-b')).toMatchObject({
      status: 'ready',
      events: [expect.objectContaining({ source_event_id: 'source-b' })],
    });

    cleanup.deleteForConversation('conversation-a');
    expect(readSubrunTrace(db, 'conversation-a', 'parent-tool-b', 'subrun-b')).toMatchObject({
      status: 'ready',
      events: [],
    });

    db.close();
  });
});

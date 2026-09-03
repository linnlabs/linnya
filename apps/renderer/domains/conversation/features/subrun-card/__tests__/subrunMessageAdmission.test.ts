import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { SSESubRunTraceEvent } from 'linnkit/contracts';
import { ToolCallIdSchema } from 'linnkit/contracts';

import {
  loadSubrunTrace,
  SUBRUN_TRACE_SUBRUN_CARD_KINDS,
  type SubrunTraceApiPort,
  type SubrunTraceBucket,
} from '../../subrun-trace';
import { createSubrunMessageProjectionAdmission } from '../functions/admitSubrunMessageProjection';
import { createSubrunMessageAdmissionScheduler } from '../orchestration/createSubrunMessageAdmissionScheduler';
import { registerToolPresentationProjectionPort } from '../../../ports/toolPresentationProjectionPort';
import { createToolPresentationProjectionPort } from '../../../../../app/plugins/orchestration/createToolPresentationProjectionPort';
import {
  clearRendererPluginRegistryForTest,
  registerRendererPlugin,
} from '../../../../../app/plugins/registry';
import { useEnabledPluginsStore } from '../../../../../app/plugins/enabledPluginsStore';
import { commonToolConfigs } from '../../../ui/tools/configs/common';
import { webToolConfigs } from '../../../ui/tools/configs/web';
import { workspaceReadToolConfigs } from '../../../ui/tools/configs/workspace';

let unregisterProjection: (() => void) | null = null;

beforeEach(() => {
  clearRendererPluginRegistryForTest();
  setActivePinia(createPinia());
  registerRendererPlugin({
    meta: {
      id: 'subrun-message-admission-test',
      name: 'Subrun message admission test',
      version: '1.0.0',
      description: 'Production registry admission test',
      developer: 'Linnya',
      builtin: true,
      required: true,
    },
    toolCards: { ...commonToolConfigs, ...workspaceReadToolConfigs, ...webToolConfigs },
  });
  useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
  unregisterProjection = registerToolPresentationProjectionPort(
    createToolPresentationProjectionPort(),
  );
});

afterEach(() => {
  unregisterProjection?.();
  unregisterProjection = null;
  clearRendererPluginRegistryForTest();
});

function event(
  kind: SSESubRunTraceEvent['kind'],
  fields: Partial<SSESubRunTraceEvent>,
): SSESubRunTraceEvent {
  return {
    type: 'subrun_trace',
    id: `trace-${kind}`,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    timestamp: 1,
    parent_tool_call_id: ToolCallIdSchema.parse('parent-call'),
    subrun_id: 'subrun-1',
    source_event_id: `source-${kind}`,
    kind,
    ...fields,
  };
}

function initialEvents(): SSESubRunTraceEvent[] {
  const callId = ToolCallIdSchema.parse('read-call');
  const args = { locator: 'workspace:/doc.md' };
  return [
    event('tool_call_decision', {
      tool_calls: [{ tool_call_id: callId, tool_name: 'read_file', args }],
    }),
    event('tool_process', {
      tool_call_id: callId,
      tool_name: 'read_file',
      phase: 'start',
      status: 'loading',
      args,
    }),
  ];
}

describe('Subrun full-message admission', () => {
  it('重启后从紧凑 final_answer 历史恢复完整 child answer', async () => {
    const api: SubrunTraceApiPort = {
      async readSubrunTrace(_conversationId, _parentToolCallId, options) {
        return {
          success: true,
          conversation_id: 'conversation-1',
          parent_tool_call_id: 'parent-call',
          subrun_id: options.subrunId,
          events: [{
            type: 'subrun_trace',
            id: 'trace-final-answer',
            conversation_id: 'conversation-1',
            turn_id: 'turn-1',
            timestamp: 2,
            version: 1,
            ephemeral: true,
            parent_tool_call_id: ToolCallIdSchema.parse('parent-call'),
            subrun_id: 'subrun-1',
            source_event_id: 'source-final-answer',
            kind: 'final_answer',
            answer_id: 'answer-1',
            content: '历史恢复后的完整回答',
            completion_reason: 'terminal',
          }],
          next_cursor: null,
          revision: 1,
        };
      },
    };
    const loaded = await loadSubrunTrace(
      'conversation-1',
      'parent-call',
      {
        subrunId: 'subrun-1',
        kinds: SUBRUN_TRACE_SUBRUN_CARD_KINDS,
      },
      { api },
    );
    if (loaded.status !== 'ready') throw new Error('历史 trace 应已就绪');

    const snapshot = createSubrunMessageProjectionAdmission().admit(
      loaded.buckets['subrun-1'] ?? null,
    );
    expect(snapshot.messages).toMatchObject([{
      id: 'subrun_subrun-1_answer_answer-1',
      type: 'final_answer',
      content: '历史恢复后的完整回答',
      metadata: {
        answer_id: 'answer-1',
        completion_reason: 'terminal',
        seal_source_event_id: 'source-final-answer',
        is_complete: true,
      },
    }]);
  });

  it('重启后从紧凑 history_summary 历史恢复既有 Summary 消息', async () => {
    const api: SubrunTraceApiPort = {
      async readSubrunTrace(_conversationId, _parentToolCallId, options) {
        return {
          success: true,
          conversation_id: 'conversation-1',
          parent_tool_call_id: 'parent-call',
          subrun_id: options.subrunId,
          events: [{
            type: 'subrun_trace',
            id: 'trace-history-summary',
            conversation_id: 'conversation-1',
            turn_id: 'turn-1',
            timestamp: 2,
            version: 1,
            ephemeral: true,
            parent_tool_call_id: ToolCallIdSchema.parse('parent-call'),
            subrun_id: 'subrun-1',
            source_event_id: 'source-history-summary',
            kind: 'history_summary',
            original_message_count: 8,
            compression_ratio: 0.25,
            included_old_summary: false,
            replaced_message_ids: ['source-old-tool-output'],
          }],
          next_cursor: null,
          revision: 1,
        };
      },
    };
    const loaded = await loadSubrunTrace(
      'conversation-1',
      'parent-call',
      {
        subrunId: 'subrun-1',
        kinds: SUBRUN_TRACE_SUBRUN_CARD_KINDS,
      },
      { api },
    );
    if (loaded.status !== 'ready') throw new Error('历史 trace 应已就绪');

    const snapshot = createSubrunMessageProjectionAdmission().admit(
      loaded.buckets['subrun-1'] ?? null,
    );
    expect(snapshot.messages).toMatchObject([{
      id: 'subrun-summary:subrun-1:source-history-summary',
      role: 'system',
      type: 'history_summary',
      content: '',
      metadata: {
        turn_id: 'turn-1',
        run_id: 'subrun-1',
        summary: {
          info: {
            originalMessageCount: 8,
            compressedMessageCount: 1,
            compressionRatio: 0.25,
          },
          includedOldSummary: false,
          replacedMessageIds: ['source-old-tool-output'],
        },
      },
    }]);
  });

  it('durable decision + output 在没有 ephemeral process 时恢复 args 与终态 presentation', () => {
    const admission = createSubrunMessageProjectionAdmission();
    const callId = ToolCallIdSchema.parse('search-call');
    const query = 'subrun admission';
    const events = [
      event('tool_call_decision', {
        tool_calls: [{
          tool_call_id: callId,
          tool_name: 'web_search',
          args: { query, top_k: 10 },
        }],
      }),
      event('tool_output', {
        source_event_id: 'source-web-output',
        timestamp: 2,
        tool_call_id: callId,
        tool_name: 'web_search',
        status: 'success',
        output: {
          data: {
            query,
            resultCount: 0,
            citations: { query, searchMode: 'web', citations: [] },
            evidence_store: { bundle_id: 'bundle-1' },
            cacheStatus: 'miss',
          },
          observation: '0 results',
        },
      }),
    ];

    const snapshot = admission.admit({ subrun_id: 'subrun-1', events });
    expect(snapshot.messages).toMatchObject([{
      id: 'subrun-tool:subrun-1:search-call',
      metadata: {
        args: { query, top_k: 10 },
        status: 'success',
      },
      toolPresentation: {
        uiKey: 'web_search',
        data: { kind: 'results', query, items: [] },
      },
    }]);
  });

  it('同一 child read_file 从 loading 文件展示切换到 success 图片展示，不新增第二条消息', () => {
    const admission = createSubrunMessageProjectionAdmission();
    const events = initialEvents();
    const bucket: SubrunTraceBucket = { subrun_id: 'subrun-1', events };

    const loading = admission.admit(bucket);
    expect(loading.messages).toHaveLength(1);
    expect(loading.messages[0]).toMatchObject({
      id: 'subrun-tool:subrun-1:read-call',
      toolPresentation: { uiKey: 'workspace_read_file' },
    });

    events.push(event('tool_output', {
      source_event_id: 'source-read-image-output',
      timestamp: 2,
      tool_call_id: ToolCallIdSchema.parse('read-call'),
      tool_name: 'read_file',
      status: 'success',
      attachments: [{
        id: 'child-image-attachment',
        kind: 'image',
        resourceId: 'child-image-asset',
        mediaType: 'image/png',
        byteLength: 1024,
        width: 1600,
        height: 900,
        sha256: 'a'.repeat(64),
        fileName: 'slide-007.png',
      }],
      output: {
        data: {
          source_kind: 'conversation_file',
          locator: 'conversation:/slides-renders/run-1/slide-007.png',
          file_name: 'slide-007.png',
          content_type: 'image/png',
          byte_length: 1024,
          width: 1600,
          height: 900,
        },
        observation: '图片已进入 child 模型输入。',
      },
    }));

    const success = admission.admit(bucket);
    expect(success.messages).toHaveLength(1);
    expect(success.messages[0]).toMatchObject({
      id: 'subrun-tool:subrun-1:read-call',
      metadata: { tool_call_id: 'read-call', status: 'success' },
      attachments: [{
        id: 'child-image-attachment',
        assetId: 'child-image-asset',
        fileName: 'slide-007.png',
      }],
      toolPresentation: {
        uiKey: 'image_read',
        data: { kind: 'image', source: 'conversation_file', fileName: 'slide-007.png' },
        title: { text: { key: 'conversation.tool.imageRead.title' } },
      },
    });
  });

  it('旧 trace 没有 attachments 时仍恢复图片 presentation，但不伪造预览身份', () => {
    const admission = createSubrunMessageProjectionAdmission();
    const events = initialEvents();
    events.push(event('tool_output', {
      source_event_id: 'source-legacy-read-image-output',
      timestamp: 2,
      tool_call_id: ToolCallIdSchema.parse('read-call'),
      tool_name: 'read_file',
      status: 'success',
      output: {
        data: {
          source_kind: 'conversation_file',
          locator: 'conversation:/slides-renders/run-1/slide-legacy.png',
          file_name: 'slide-legacy.png',
          content_type: 'image/png',
          byte_length: 512,
          width: 800,
          height: 450,
        },
        observation: '历史图片读取完成。',
      },
    }));

    const snapshot = admission.admit({ subrun_id: 'subrun-1', events });
    expect(snapshot.messages[0]).toMatchObject({
      toolPresentation: { uiKey: 'image_read' },
    });
    expect(snapshot.messages[0]).not.toHaveProperty('attachments');
  });

  it('child tool citation 会进入 child 消息自己的依赖快照', () => {
    const admission = createSubrunMessageProjectionAdmission();
    const callId = ToolCallIdSchema.parse('citation-search-call');
    const query = 'child citation';
    const events = [
      event('tool_call_decision', {
        tool_calls: [{
          tool_call_id: callId,
          tool_name: 'web_search',
          args: { query, top_k: 10 },
        }],
      }),
      event('tool_output', {
        source_event_id: 'source-citation-output',
        timestamp: 2,
        tool_call_id: callId,
        tool_name: 'web_search',
        status: 'success',
        output: {
          data: {
            query,
            resultCount: 1,
            citations: {
              query,
              searchMode: 'web',
              citations: [{
                sourceType: 'web',
                ref: 'Ab3Def',
                index: 1,
                url: 'https://example.com/child',
                docTitle: 'child source',
                snippet: 'child snippet',
              }],
            },
            evidence_store: { bundle_id: 'bundle-child-citation' },
            cacheStatus: 'miss',
          },
          observation: 'child search complete',
        },
      }),
      event('thought_complete', {
        source_event_id: 'source-citation-thought',
        timestamp: 3,
        content: 'child conclusion [@Ab3Def]',
      }),
    ];

    const snapshot = admission.admit({ subrun_id: 'subrun-1', events });
    const thought = snapshot.messages.find(message => message.type === 'thought');
    expect(thought?.citationDependencies).toEqual({
      citations: [expect.objectContaining({
        ref: 'Ab3Def',
        url: 'https://example.com/child',
      })],
      unresolved_refs: [],
    });
  });

  it('穿过正式工具 registry 生成 presentation，并在尾部失败时保持旧 snapshot 原子不变', () => {
    const admission = createSubrunMessageProjectionAdmission();
    const events = initialEvents();
    const bucket: SubrunTraceBucket = { subrun_id: 'subrun-1', events };

    const admitted = admission.admit(bucket);
    expect(admitted.messages).toHaveLength(1);
    expect(admitted.messages[0]).toMatchObject({
      id: 'subrun-tool:subrun-1:read-call',
      type: 'tool_calls',
      metadata: { status: 'loading' },
      toolPresentation: { data: expect.any(Object) },
    });

    events.push(event('tool_process', {
      tool_call_id: ToolCallIdSchema.parse('read-call'),
      tool_name: 'write_file',
      phase: 'start',
      status: 'loading',
      args: { locator: 'workspace:/doc.md', content: 'bad identity' },
    }));

    expect(() => admission.admit(bucket)).toThrow('[SUBRUN_MESSAGE_ADMISSION_FAILED]');
    expect(admitted.messages).toHaveLength(1);
    const [preservedMessage] = admitted.messages;
    if (!preservedMessage || preservedMessage.type !== 'tool_calls') {
      throw new Error('失败后必须保留上一个已接纳的工具消息');
    }
    expect(preservedMessage.metadata.status).toBe('loading');
  });

  it('scheduler 在 reactive flush 之外报告错误，不发布半成品 snapshot', async () => {
    const commits: number[] = [];
    const errors: Error[] = [];
    const scheduler = createSubrunMessageAdmissionScheduler({
      onCommit: snapshot => commits.push(snapshot.version),
      onError: error => errors.push(error),
    });
    const events = initialEvents();
    const bucket: SubrunTraceBucket = { subrun_id: 'subrun-1', events };

    scheduler.request(bucket);
    await Promise.resolve();
    expect(commits).toHaveLength(1);

    events.push(event('tool_output', {
      tool_call_id: ToolCallIdSchema.parse('missing-call'),
      tool_name: 'read_file',
      status: 'success',
      output: { data: {}, observation: 'invalid' },
    }));
    scheduler.request(bucket);
    await Promise.resolve();

    expect(commits).toHaveLength(1);
    expect(errors[0]?.message).toContain('[SUBRUN_MESSAGE_ADMISSION_FAILED]');
    scheduler.dispose();
  });
});

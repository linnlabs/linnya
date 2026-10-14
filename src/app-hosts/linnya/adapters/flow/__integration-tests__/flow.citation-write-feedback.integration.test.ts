import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSearchResultSchema, WorkspaceWriteFileResultSchema } from '@app/schemas';
import type { ScriptedToolCall } from '@linnlabs/linnkit/testkit';
import { MarkdownDocumentService } from 'src/domains/markdown';
import { BaseTool, type ToolParameterSchema } from 'src/tools/types';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { readTail } from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import type { ConversationRealtimeEvent } from '../flow.schemas';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';

// 只替换外部网页取得。正式 owner schema、Host resolver、写入事务和历史投影仍走生产链。
class AcquiredWebSource extends BaseTool {
  readonly name = 'web_search';
  readonly description = 'Synthetic source acquisition.';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: { query: { type: 'string', description: 'Query' } },
    required: ['query'],
  };

  async run(): Promise<string> {
    return JSON.stringify(WebSearchResultSchema.parse({
      data: {
        query: 'official report', resultCount: 1, cacheStatus: 'miss',
        evidence_store: { bundle_id: '0123456789abcdef' },
        citations: {
          query: 'official report', searchMode: 'web',
          citations: [{
            ref: 'Abc234', index: 23, sourceType: 'web',
            url: 'https://example.com/report', docTitle: 'Official report',
            snippet: 'Revenue rose by 10%.',
          }],
        },
      },
      observation: '[Result 23] [@Abc234]\nURL: https://example.com/report\nRevenue rose by 10%.',
    }));
  }
}

let directory: string;
let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>> | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-citation-feedback-'));
  setPluginRuntimeStateForTests({ installedPluginIds: ['platform'], enabledPluginIds: ['platform'] });
  installRecoveryModelFixture();
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture?.close();
  fixture = undefined;
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function fileCall(id: string, name: string, args: Record<string, unknown>): ScriptedToolCall {
  return { id, name, argumentsJson: JSON.stringify({ locator: 'workspace:/report.md', ...args }) };
}

describe('citation write feedback through durable Flow', () => {
  it('拒绝序号/别名/伪造ref，纠正后 write/edit 持久化已取得来源，下一模型请求和历史保留同一失败反馈', async () => {
    const calls: ScriptedToolCall[] = [
      { id: 'source', name: 'web_search', argumentsJson: JSON.stringify({ query: 'official report' }) },
      fileCall('invalid-create', 'write_file', {
        content: 'Revenue rose [@23] [@Report] [@Abc234/@0123456789abcdef].',
      }),
      fileCall('unknown-create', 'write_file', { content: 'Revenue rose [@Def567].' }),
      fileCall('create', 'write_file', { content: 'Revenue rose [@Abc234].' }),
      fileCall('invalid-edit', 'edit_file', { old_string: 'rose', new_string: 'rose 10% [@23]' }),
      fileCall('edit', 'edit_file', { old_string: 'rose', new_string: 'rose 10%' }),
      fileCall('read', 'read_file', {}),
    ];
    fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [
      ...calls.map(tool => ({ toolCalls: [tool] })),
      { contentChunks: ['Saved with the acquired source.'] },
    ], [new AcquiredWebSource()]);
    const conversationId = 'citation-write-feedback';
    const workspace = new WorkspaceService(fixture.db);
    const projectId = workspace.createProject('Citation write feedback');
    await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
    const store = new MarkdownDocumentService(fixture.db);
    const live: ConversationRealtimeEvent[] = [];
    let documentId: string | undefined;
    await fixture.flow.next({
      conversation_id: conversationId, project_id: projectId,
      new_events: [{ type: 'user_input', content: 'Save the sourced report.', source: 'user', timestamp: 1 }],
      options: {
        promptKey: 'default', model_id: 'scripted-test-model',
        project_metadata: { id: projectId, name: 'Citation write feedback' },
      },
    }, event => {
      live.push(event);
      if (event.type !== 'tool_output') return;
      if (event.tool_call_id === 'invalid-create' || event.tool_call_id === 'unknown-create') {
        // 来源 admission 失败前不创建空文档，避免错误回执却已经改变 Workspace。
        expect(workspace.getChildNodes(null, projectId)).toEqual([]);
      }
      if (event.tool_call_id === 'create') {
        documentId = WorkspaceWriteFileResultSchema.parse({ data: event.data, observation: event.observation }).data.documentId;
      }
      if (event.tool_call_id === 'invalid-edit' && documentId) {
        expect(store.getPendingRevisions(documentId)).toEqual([]);
      }
    });
    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    const outputs = events.filter(event => event.type === 'tool_output');
    expect(outputs.map(event => [event.tool_call_id, event.status])).toEqual([
      ['source', 'success'], ['invalid-create', 'error'], ['unknown-create', 'error'],
      ['create', 'success'], ['invalid-edit', 'error'], ['edit', 'success'], ['read', 'success'],
    ]);
    for (const id of ['invalid-create', 'unknown-create', 'invalid-edit']) {
      const result = outputs.find(event => event.tool_call_id === id);
      if (!result) throw new Error(`Missing result ${id}`);
      const message = result.observation;
      if (id === 'unknown-create') {
        expect(message).toContain('valid syntax but no matching source');
        expect(message).toContain('in this conversation');
      } else {
        expect(message).toContain('six-character source ID');
        expect(message).toContain('not a Result number');
        expect(message).toContain('source name, or content-boundary ID');
        expect(message).toContain('This write was not applied');
      }
      const nextRequest = fixture.ai.getCalls()[calls.findIndex(call => call.id === id) + 1];
      expect(nextRequest?.messages.find(item => item.role === 'tool' && item.tool_call_id === id))
        .toMatchObject({ content: [{ type: 'text', text: message }] });
      expect(live.find(event => event.type === 'tool_output' && event.tool_call_id === id))
        .toMatchObject({ status: 'error', observation: message });
      const reloaded = readTail(fixture.db, conversationId, 100);
      if (reloaded.status !== 'ready') throw new Error('Expected durable UI window');
      expect(reloaded.messages.find(item => item.message_type === 'tool_calls' && item.payload.tool_call_id === id))
        .toMatchObject({ content: message });
    }
    const read = outputs.find(event => event.tool_call_id === 'read');
    expect(read?.observation).toContain('Revenue rose 10%');
    expect(read?.data).toMatchObject({
      citations: { citations: [expect.objectContaining({
        sourceType: 'web', url: 'https://example.com/report', snippet: 'Revenue rose by 10%.',
      })] },
    });
    if (!documentId) throw new Error('Expected a saved document');
    expect(store.getPendingRevisions(documentId)).toHaveLength(1);
    fixture.ai.assertAllTurnsConsumed();
  });
});

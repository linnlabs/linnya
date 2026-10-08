/** 合成 CLI/Workspace 业务夹具；不连接真实 App 或模型。 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import {
  ConversationUiMessageSchema,
  type ConversationControlRunStatusSnapshot,
} from '@app/schemas';
import type { ResearchWorkflowCliPort, ResearchToolMessage } from '../definitions/researchWorkflow';

const temporary: string[] = [];
export async function cleanupFixtures() {
  await Promise.all(
    temporary.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
  );
}
export function tool(
  name: string,
  data: unknown,
  content: string,
  args: Record<string, unknown> = {},
  seq = 1
): ResearchToolMessage {
  const message = ConversationUiMessageSchema.parse({
    message_id: `msg-${seq}`,
    conversation_id: 'inspection',
    run_id: 'run',
    turn_id: 'turn',
    sort_seq: seq,
    timestamp: seq,
    content,
    merge_key: null,
    presentation: null,
    role: 'assistant',
    message_type: 'tool_calls',
    payload: {
      tool_call_id: `call-${seq}`,
      tool_name: name,
      status: 'success',
      phase: 'complete',
      started_at: 1,
      completed_at: 2,
      args,
      data,
    },
  });
  if (message.message_type !== 'tool_calls') throw new Error('Invalid test message');
  return message;
}
export function textRead(locator: string, content: string, offset = 1, limit = 200) {
  const lines = content ? content.split('\n') : [];
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  const next = offset + selected.length;
  return tool(
    'read_file',
    {
      source_kind: 'workspace_vfs',
      locator,
      inode: locator,
      node: {
        name: locator,
        locator,
        inode: locator,
        type: 'document',
        source: 'workspace_node',
        is_virtual: false,
        parent_id: null,
        updated_at: 1,
      },
      content_type: 'text/markdown',
      offset,
      limit,
      line_count: selected.length,
      total_line_count: lines.length,
      has_more: next <= lines.length,
      ...(next <= lines.length ? { next_offset: next } : {}),
    },
    selected.map((line, index) => `${offset + index} | ${line}`).join('\n') || 'empty',
    { locator }
  );
}
export function status(
  value: ConversationControlRunStatusSnapshot['status'],
  execution = 'execution'
): ConversationControlRunStatusSnapshot {
  return {
    conversation_id: 'conversation',
    run_id: 'run',
    turn_id: 'turn',
    execution_id: execution,
    agent_id: 'default',
    status: value,
    started_at: 1,
    updated_at: 2,
    result_available: value === 'completed',
    ...(value === 'paused' ? { pause: { settled: true, reason: 'execution_interrupted' } } : {}),
  };
}
export function writeResult(locator: string, sequence = 1, inodeOnly = false) {
  return tool(
    'write_file',
    {
      source_kind: 'workspace_vfs',
      locator,
      inode: 'workspace:output',
      documentId: 'output',
      operation: 'create',
      node: {
        name: locator,
        locator,
        inode: 'workspace:output',
        type: 'document',
        source: 'workspace_node',
        is_virtual: false,
        parent_id: null,
        updated_at: 1,
      },
    },
    'saved',
    inodeOnly ? { inode: 'workspace:output' } : { locator },
    sequence
  );
}
export function fakeCli(
  documents: Map<string, string>,
  overrides: Partial<ResearchWorkflowCliPort> = {}
): ResearchWorkflowCliPort {
  const written = writeResult('workspace:/output.md');
  return {
    send: vi.fn<ResearchWorkflowCliPort['send']>(async () => ({
      conversation_id: 'conversation',
      run_id: 'run',
      turn_id: 'turn',
      execution_id: 'execution',
      agent_id: 'default',
      accepted_at: 1,
      user_message_id: 'user',
    })),
    status: vi.fn<ResearchWorkflowCliPort['status']>(async () => status('completed')),
    watchStatus: vi.fn<ResearchWorkflowCliPort['watchStatus']>(async () => ({
      frames: [],
      timedOut: true,
    })),
    resume: vi.fn<ResearchWorkflowCliPort['resume']>(async () => ({
      schema_version: 1,
      ok: true,
      command: 'resume',
      receipt: {
        conversation_id: 'conversation',
        run_id: 'run',
        turn_id: 'turn',
        execution_id: 'execution-2',
        agent_id: 'default',
        accepted_at: 2,
      },
    })),
    stop: vi.fn<ResearchWorkflowCliPort['stop']>(async () => {
      throw new Error('Must not stop');
    }),
    approve: vi.fn<ResearchWorkflowCliPort['approve']>(async () => {
      throw new Error('Must not approve');
    }),
    result: vi.fn<ResearchWorkflowCliPort['result']>(async () => ({
      outcome: 'completed',
      completedAt: 3,
      resultStatus: 'available',
      finalAnswer: 'saved',
    })),
    messages: vi.fn<ResearchWorkflowCliPort['messages']>(async () => ({
      schema_version: 1,
      ok: true,
      command: 'messages',
      conversation_id: 'conversation',
      status: 'preparing',
    })),
    messagePage: vi.fn<ResearchWorkflowCliPort['messagePage']>(async () => ({
      schema_version: 1,
      ok: true,
      command: 'messages',
      conversation_id: 'conversation',
      status: 'ready',
      messages: [written],
      has_more_before: false,
      has_more_after: false,
      revision: 1,
    })),
    audit: vi.fn<ResearchWorkflowCliPort['audit']>(async () => {
      throw new Error('audit disabled');
    }),
    workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
      const locator = request.args.locator;
      if (typeof locator !== 'string') throw new Error('Missing locator');
      if (request.tool === 'write_file') {
        const content = request.args.content;
        if (typeof content !== 'string') throw new Error('Missing content');
        documents.set(locator, content);
        return tool('write_file', {}, 'saved', { locator });
      }
      const text = documents.get(locator);
      if (text === undefined) throw new Error(`Missing document ${locator}`);
      return textRead(
        locator,
        text,
        typeof request.args.offset === 'number' ? request.args.offset : 1,
        typeof request.args.limit === 'number' ? request.args.limit : 200
      );
    }),
    ...overrides,
  };
}
export async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'research-workflow-test-'));
  temporary.push(directory);
  const manifestFile = path.join(directory, 'manifest.json');
  await writeFile(path.join(directory, 'prompt.md'), 'Revise the given article.');
  await writeFile(
    manifestFile,
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'project',
      stages: [
        {
          id: 'D1',
          modelId: 'model',
          skill: 'method-x',
          promptFile: 'prompt.md',
          allowedMaterials: ['workspace:/input.md'],
          expectedDocuments: ['workspace:/output.md'],
          network: 'forbidden',
        },
      ],
    })
  );
  return { manifestFile, output: path.join(directory, 'results') };
}

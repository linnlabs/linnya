import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationControlClient } from '../definitions/cli';
import { executeToolCall } from './executeToolCall';

const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const sha256 = createHash('sha256').update(imageBytes).digest('hex');
const conversationId = `conversation-cli-attachment-${process.pid}`;
const attachment = {
  id: 'read-file-pdf-page:1',
  kind: 'image' as const,
  assetId: 'asset-page-1',
  mediaType: 'image/jpeg' as const,
  byteLength: imageBytes.byteLength,
  width: 1087,
  height: 1536,
  sha256,
};

afterEach(async () => {
  await rm(path.join(os.tmpdir(), 'linnya-cli', 'attachments', conversationId), { recursive: true, force: true });
});

function createClient(reads: unknown[]): ConversationControlClient['execute'] {
  return async request => {
    if (request.command === 'tools' && request.action === 'call') {
      return {
        schema_version: 1, ok: true, command: 'tools', action: 'call', tool_name: 'read_file',
        receipt: {
          conversation_id: conversationId, user_message_id: 'message-1', turn_id: 'turn-1', run_id: 'run-1',
          execution_id: 'execution-1', agent_id: 'default', accepted_at: 1,
        },
      };
    }
    if (request.command === 'tools' && request.action === 'read_attachment') {
      reads.push(request);
      return {
        schema_version: 1, ok: true, command: 'tools', action: 'read_attachment',
        attachment, content_base64: imageBytes.toString('base64'),
      };
    }
    if (request.command === 'status') {
      return {
        schema_version: 1, ok: true, command: 'status', conversation_id: conversationId,
        run: {
          conversation_id: conversationId, run_id: 'run-1', turn_id: 'turn-1', execution_id: 'execution-1',
          agent_id: 'default', status: 'completed', started_at: 1, updated_at: 2, terminal_at: 2,
          command_approvals: [], result_available: false,
        },
      };
    }
    if (request.command === 'messages') {
      return {
        schema_version: 1, ok: true, command: 'messages', status: 'ready', conversation_id: conversationId,
        messages: [{
          message_id: 'tool-message-1', conversation_id: conversationId, turn_id: 'turn-1', sort_seq: 2,
          timestamp: 2, content: 'PDF page rendered', attachments: [attachment], merge_key: 'tool:run-1:call-1',
          presentation: null, run_id: 'run-1', role: 'assistant', message_type: 'tool_calls',
          payload: {
            tool_call_id: 'call-1', tool_name: 'read_file', status: 'success', phase: 'complete',
            args: { locator: 'file:///tmp/report.pdf', view: 'page_image', pages: '1' },
            data: { attachment_status: 'attached' }, started_at: 1, completed_at: 2,
          },
        }],
        has_more_before: false, has_more_after: false, revision: 2,
      };
    }
    throw new Error(`unexpected command ${request.command}`);
  };
}

describe('executeToolCall', () => {
  it('工具结果带图片时读取已复核的原件，写成本地文件并在输出里给出路径', async () => {
    const reads: unknown[] = [];
    const result = await executeToolCall({
      client: {
        descriptor: {} as ConversationControlClient['descriptor'],
        handshake: { limits: { min_watch_interval_ms: 1, max_watch_timeout_ms: 60_000 } },
        execute: createClient(reads),
      } as unknown as ConversationControlClient,
      request: {
        schema_version: 1, command: 'tools', action: 'call', tool_name: 'read_file', project_id: 'project-1',
        args: { locator: 'file:///tmp/report.pdf', view: 'page_image', pages: '1' },
      },
      intervalMs: 1,
      timeoutMs: 1000,
      sleep: async () => undefined,
    });

    expect(reads).toEqual([expect.objectContaining({
      conversation_id: conversationId, message_id: 'tool-message-1', attachment_id: attachment.id,
    })]);
    expect(result.attachment_files).toEqual([{
      id: attachment.id, media_type: 'image/jpeg', width: 1087, height: 1536,
      path: path.join(os.tmpdir(), 'linnya-cli', 'attachments', conversationId, `${sha256}.jpg`),
    }]);
    expect([...await readFile(result.attachment_files![0]!.path)]).toEqual([...imageBytes]);
  });
});

import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { CommandApprovalPendingProjectionV1Schema } from '@app/schemas/commands';

import { createTerminalCommandApprovalPrompt } from './createTerminalCommandApprovalPrompt';

describe('terminal command approval prompt', () => {
  it('内部存储审批说明敏感数据范围，并接收用户的本次允许', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', chunk => { text += String(chunk); });
    const prompt = createTerminalCommandApprovalPrompt({ input, output, onInterrupt: vi.fn() });
    try {
      const result = prompt.requestChoice(CommandApprovalPendingProjectionV1Schema.parse({
        protocol_version: 1,
        kind: 'command_approval_pending_projection',
        approval_request_id: `command_approval_${randomUUID()}`,
        conversation_id: 'conversation-test',
        agent_run_id: 'agent-run-test',
        origin_tool_call_id: 'tool-call-test',
        command_execution_id: `command_execution_${randomUUID()}`,
        command: 'cat internal-file',
        cwd: '/test',
        reasons: [{ type: 'internal_storage_access' }],
        available_choices: ['allow_once', 'deny'],
        requested_at_ms: 0,
        status: 'awaiting_reply',
      }));
      input.write('1\n');
      await expect(result).resolves.toBe('allow_once');
      expect(text).toContain('access Linnya internal storage');
      expect(text).toContain('credentials and private application data');
    } finally {
      prompt.close();
    }
  });

  it('把 readline 截获的 Ctrl+C 交回 Runtime lifecycle', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const onInterrupt = vi.fn();
    const prompt = createTerminalCommandApprovalPrompt({ input, output, onInterrupt });

    input.write('\u0003');
    await new Promise(resolve => setImmediate(resolve));

    expect(onInterrupt).toHaveBeenCalledOnce();
    prompt.close();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { cleanupCliBridges, createScriptedBridge, runCliProcess } from './__test-helpers__/scriptedCliBridge';

afterEach(cleanupCliBridges);

describe('Shell approvals through the real CLI process', () => {
  it('查询子 run 审批、结束等待并精确回复，拒绝旧请求且丢失回复不自动重发', async () => {
    const pending = {
      protocol_version: 1, kind: 'command_approval_pending_projection',
      approval_request_id: 'command_approval_11111111-1111-4111-8111-111111111111',
      command_execution_id: 'command_execution_22222222-2222-4222-8222-222222222222',
      conversation_id: 'conversation-1', agent_run_id: 'child-1', origin_tool_call_id: 'tool-1',
      command: 'rm scratch.txt', cwd: '/workspace',
      reasons: [{ type: 'fixed_risk_rule', rule_id: 'macos.delete.rm', category: 'delete' }],
      available_choices: ['allow_once', 'deny'], requested_at_ms: 10, status: 'awaiting_reply',
    };
    let replyCount = 0;
    const bridge = await createScriptedBridge((request, response) => {
      if (request.command === 'status') return {
        schema_version: 1, ok: true, command: 'status', conversation_id: 'conversation-1',
        run: { conversation_id: 'conversation-1', run_id: 'root-1', turn_id: 'turn-1',
          execution_id: 'execution-1', agent_id: 'default', status: 'running',
          started_at: 1, updated_at: 1, result_available: false, command_approvals: [pending] },
      };
      if (request.command !== 'command_approvals') throw new Error('Unexpected mutation');
      if (request.action === 'list') return {
        schema_version: 1, ok: true, command: 'command_approvals', action: 'list',
        conversation_id: request.conversation_id, run_id: request.run_id, pending: [pending],
      };
      expect(request.run_id).toBe('child-1');
      expect(request.approval_request_id).toBe(pending.approval_request_id);
      expect(request.choice).toBe('allow_once');
      replyCount += 1;
      if (replyCount === 3) { response.destroy(); return; }
      return { schema_version: 1, ok: true, command: 'command_approvals', action: 'reply',
        conversation_id: request.conversation_id, run_id: request.run_id,
        approval_request_id: request.approval_request_id,
        status: replyCount === 1 ? 'accepted' : 'stale' };
    });
    const list = await runCliProcess(['approvals', 'conversation-1', '--run', 'root-1'], bridge.connectionFile);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout)).toMatchObject({ pending: [{ agent_run_id: 'child-1' }] });
    const watch = await runCliProcess(['status', 'conversation-1', '--run', 'root-1', '--watch',
      '--interval', '1', '--timeout', '1000'], bridge.connectionFile);
    expect(watch.exitCode).toBe(0);
    expect(watch.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(watch.stdout)).toMatchObject({ snapshot: { status: 'running',
      command_approvals: [{ origin_tool_call_id: 'tool-1', status: 'awaiting_reply' }] } });
    const args = ['approval-reply', 'conversation-1', '--run', 'child-1',
      '--request', pending.approval_request_id, '--choice', 'allow_once'];
    expect((await runCliProcess(args, bridge.connectionFile)).exitCode).toBe(0);
    const stale = await runCliProcess(args, bridge.connectionFile);
    expect(stale.exitCode).toBe(6);
    expect(JSON.parse(stale.stdout)).toMatchObject({ status: 'stale' });
    const unknown = await runCliProcess(args, bridge.connectionFile);
    expect(unknown.exitCode).toBe(3);
    expect(replyCount).toBe(3);
    expect(bridge.receivedCommands.map(request => request.command)).toEqual([
      'command_approvals', 'status', 'command_approvals', 'command_approvals', 'command_approvals',
    ]);
  });

});

import { afterEach, describe, expect, it } from 'vitest';
import { cleanupCliBridges, createScriptedBridge, runCliProcess } from './__test-helpers__/scriptedCliBridge';

afterEach(cleanupCliBridges);

describe('Shell approvals through the real CLI process', () => {
  // 串行启动五个真实 Node/tsx 进程；共享 CI runner 的冷启动总耗时会超过单例默认的 5 秒。
  // 这里只给完整审批往返留出进程启动预算，watch 的 1 秒业务超时和精确请求数断言保持不变。
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
        external_approval: { permitted: true },
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
  }, 20_000);

  // 三个真实 CLI 进程；预算同上，只为进程冷启动留余量。
  it('只有用户能批时：说明原样交到调用方，提交允许以退出码 9 失败且不重试，带理由的拒绝把理由送到 App', async () => {
    const pending = {
      protocol_version: 1, kind: 'command_approval_pending_projection',
      approval_request_id: 'command_approval_33333333-3333-4333-8333-333333333333',
      command_execution_id: 'command_execution_44444444-4444-4444-8444-444444444444',
      conversation_id: 'conversation-1', agent_run_id: 'run-1', origin_tool_call_id: 'tool-1',
      command: 'rm -r reports', cwd: '/workspace',
      reasons: [{ type: 'fixed_risk_rule', rule_id: 'macos.delete.rm', category: 'delete' }],
      available_choices: ['allow_once', 'deny'], requested_at_ms: 10, status: 'awaiting_reply',
    };
    const message = 'Only the user can approve commands: ask the user to approve this command in the Linnya desktop app.';
    const bridge = await createScriptedBridge((request, response) => {
      if (request.command !== 'command_approvals') throw new Error('Unexpected command');
      const scope = { schema_version: 1, command: 'command_approvals',
        conversation_id: request.conversation_id, run_id: request.run_id };
      if (request.action === 'list') {
        return { ...scope, ok: true, action: 'list', pending: [pending], external_approval: { permitted: false, message } };
      }
      if (request.choice !== 'deny') {
        // 与真实桥接一致：连接合法，只是这一步需要用户本人，HTTP 403 加结构化错误。
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ schema_version: 1, ok: false, command: 'command_approvals',
          error: { code: 'approval_requires_user', message, retryable: false } }));
        return;
      }
      return { ...scope, ok: true, action: 'reply', approval_request_id: request.approval_request_id, status: 'accepted' };
    });
    const list = await runCliProcess(['approvals', 'conversation-1', '--run', 'run-1'], bridge.connectionFile);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout)).toMatchObject({
      pending: [{ available_choices: ['allow_once', 'deny'] }],
      external_approval: { permitted: false, message },
    });
    const reply = ['approval-reply', 'conversation-1', '--run', 'run-1', '--request', pending.approval_request_id];
    const refused = await runCliProcess([...reply, '--choice', 'allow_once'], bridge.connectionFile);
    expect(refused.exitCode).toBe(9);
    expect(refused.stdout).toBe('');
    expect(JSON.parse(refused.stderr)).toMatchObject({
      ok: false, command: 'command_approvals',
      error: { code: 'approval_requires_user', message, retryable: false },
    });
    const denied = await runCliProcess([...reply, '--choice', 'deny', '--reason', 'move it to scratch/ instead'], bridge.connectionFile);
    expect(denied.exitCode).toBe(0);
    expect(JSON.parse(denied.stdout)).toMatchObject({ status: 'accepted' });
    // 被拒的“允许”只发了一次请求；拒绝的理由随请求到达 App。
    expect(bridge.receivedCommands).toMatchObject([
      { action: 'list' },
      { action: 'reply', choice: 'allow_once' },
      { action: 'reply', choice: 'deny', deny_reason: 'move it to scratch/ instead' },
    ]);
  }, 20_000);

});

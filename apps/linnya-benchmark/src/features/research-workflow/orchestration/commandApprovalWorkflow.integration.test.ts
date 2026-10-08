import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandApprovalPendingProjectionV1Schema } from '@app/schemas';
import type { ResearchWorkflowCliPort } from '../definitions/researchWorkflow';
import { runResearchWorkflow } from './runResearchWorkflow';
import {
  cleanupFixtures, fakeCli, fixture, status,
} from './__test-helpers__/researchWorkflowFixture';

afterEach(cleanupFixtures);

describe('research workflow command approval observation', () => {
  it('保存 Shell 等待并在原请求批准后接着观察，不重发、不用 resume 或普通 HITL', async () => {
    const options = await fixture();
    const pending = CommandApprovalPendingProjectionV1Schema.parse({
      protocol_version: 1, kind: 'command_approval_pending_projection',
      approval_request_id: 'command_approval_11111111-1111-4111-8111-111111111111',
      command_execution_id: 'command_execution_22222222-2222-4222-8222-222222222222',
      conversation_id: 'conversation', agent_run_id: 'child-1', origin_tool_call_id: 'tool-1',
      command: 'rm scratch.txt', cwd: '/workspace',
      reasons: [{ type: 'fixed_risk_rule', rule_id: 'macos.delete.rm', category: 'delete' }],
      available_choices: ['allow_once', 'deny'], requested_at_ms: 10, status: 'awaiting_reply',
    });
    let current = { ...status('running'), command_approvals: [pending] };
    const cli = fakeCli(new Map([
      ['workspace:/input.md', '依据'], ['workspace:/output.md', '成稿'],
    ]), {
      status: vi.fn<ResearchWorkflowCliPort['status']>(async () => current),
      watchStatus: vi.fn<ResearchWorkflowCliPort['watchStatus']>(async () => {
        current = status('completed');
        return { frames: [], timedOut: false };
      }),
    });
    const first = await runResearchWorkflow({ ...options, cli });
    expect(first.stages[0]).toMatchObject({ status: 'waiting_command_approval',
      commandApprovals: [{ agent_run_id: 'child-1', origin_tool_call_id: 'tool-1' }] });
    expect(cli.watchStatus).not.toHaveBeenCalled();
    await runResearchWorkflow({ ...options, cli });
    expect(cli.send).toHaveBeenCalledOnce();
    expect(cli.watchStatus).not.toHaveBeenCalled();
    // processing 表示别的客户端已经作答，不能当成待审批再次退出。
    current = { ...status('running'), command_approvals: [{ ...pending, status: 'processing' }] };
    const completed = await runResearchWorkflow({ ...options, cli });
    expect(completed.stages[0]).toMatchObject({ status: 'completed', commandApprovals: [],
      receipt: { run_id: 'run', execution_id: 'execution' } });
    expect(cli.send).toHaveBeenCalledOnce();
    expect(cli.watchStatus).toHaveBeenCalledOnce();
    expect(cli.resume).not.toHaveBeenCalled();
    expect(cli.approve).not.toHaveBeenCalled();
    expect(cli.stop).not.toHaveBeenCalled();
    const original = await readFile(path.join(options.output, 'D1', 'command-approval-observations.jsonl'), 'utf8');
    expect(original.trim().split('\n')).toHaveLength(2);
  });

});

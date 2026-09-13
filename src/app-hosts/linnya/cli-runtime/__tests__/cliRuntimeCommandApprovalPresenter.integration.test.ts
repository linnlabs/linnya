import { describe, expect, it } from 'vitest';

import { parseCommandApprovalRequest } from '@app/schemas/commands';
import {
  createCommandApprovalHost,
} from '../../adapters/commands/approval-host';
import { createCliRuntimeCommandApprovalPresenter } from '../orchestration/createCliRuntimeCommandApprovalPresenter';

describe('CLI Runtime command approval presenter', () => {
  it('串行展示并只提交 Backend 已声明的选择', async () => {
    const host = createCommandApprovalHost();
    host.enableHostPresenter();
    const choices: Array<(choice: 'allow_once' | 'deny') => void> = [];
    const observed: string[] = [];
    const presenter = createCliRuntimeCommandApprovalPresenter({
      gateway: createLocalHostPresenterGateway(host),
      prompt: {
        requestChoice(approval) {
          observed.push(approval.command);
          return new Promise(resolve => choices.push(resolve));
        },
        close() {},
      },
      reportFailure(error) { throw error; },
    });
    await presenter.start();

    const first = host.request({ request: createApprovalRequest(1, 'printf first') });
    const second = host.request({ request: createApprovalRequest(2, 'printf second') });
    await waitFor(() => observed.length === 1);
    expect(observed).toEqual(['printf first']);

    choices[0]?.('allow_once');
    await expect(first).resolves.toMatchObject({
      status: 'replied',
      reply: { choice: 'allow_once' },
    });
    await waitFor(() => observed.length === 2);
    choices[1]?.('deny');
    await expect(second).resolves.toMatchObject({
      status: 'replied',
      reply: { choice: 'deny' },
    });
    presenter.dispose();
  });

  it('输入端失败时拒绝当前命令，不能把异常变成默认放行或永久等待', async () => {
    const host = createCommandApprovalHost();
    host.enableHostPresenter();
    const failures: Error[] = [];
    const presenter = createCliRuntimeCommandApprovalPresenter({
      gateway: createLocalHostPresenterGateway(host),
      prompt: {
        async requestChoice() { throw new Error('stdin closed'); },
        close() {},
      },
      reportFailure(error) { failures.push(error); },
    });
    await presenter.start();

    await expect(host.request({
      request: createApprovalRequest(3, 'printf denied'),
    })).resolves.toMatchObject({
      status: 'replied',
      reply: { choice: 'deny' },
    });
    expect(failures.map(error => error.message)).toEqual(['stdin closed']);
    presenter.dispose();
  });
});

function createLocalHostPresenterGateway(host: ReturnType<typeof createCommandApprovalHost>) {
  return {
    async read() { return host.readHostPresenter(); },
    async submit(input: Parameters<typeof host.submitHostReply>[0]) {
      return host.submitHostReply(input);
    },
    subscribe(listener: () => void) { return host.subscribe(listener); },
  };
}

function createApprovalRequest(sequence: number, command: string) {
  const suffix = sequence.toString().padStart(12, '0');
  const identity = {
    conversation_id: `conversation-${sequence}`,
    agent_run_id: `run-${sequence}`,
    origin_tool_call_id: `tool-${sequence}`,
    command_execution_id: `command_execution_00000000-0000-4000-8000-${suffix}`,
    owner_generation_id: `command_owner_00000000-0000-4000-8000-${suffix}`,
    created_at_ms: sequence,
  };
  return parseCommandApprovalRequest({
    protocol_version: 1,
    kind: 'command_approval_request',
    approval_request_id: `command_approval_00000000-0000-4000-8000-${suffix}`,
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command,
      cwd: '/tmp/workspace',
      permission: {
        protocol_version: 1,
        kind: 'command_permission_snapshot',
        identity,
        base_level: 'read_only',
        effective_level: 'read_only',
        grant_source: 'global_setting',
        internal_data_access: 'denied',
      },
    },
    reasons: [{
      type: 'permission_elevation',
      from_level: 'read_only',
      to_level: 'standard',
    }],
    available_choices: ['allow_once', 'deny'],
    requested_at_ms: sequence,
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('等待审批 presenter 超时');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

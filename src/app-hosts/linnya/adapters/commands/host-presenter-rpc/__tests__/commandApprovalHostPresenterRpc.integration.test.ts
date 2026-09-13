import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';
import {
  parseCommandApprovalRequest,
  type CommandApprovalRequestV1,
} from '@app/schemas/commands';

import { createAppServerRpcPeer, type AppServerRpcPeer } from '../../../../app-server-rpc';
import { createCommandApprovalHost } from '../../approval-host';
import {
  attachCommandApprovalHostPresenterPublisher,
  createCommandApprovalHostPresenterBackendRpcHandlers,
} from '../orchestration/createCommandApprovalHostPresenterBackendRpc';
import { createCommandApprovalHostPresenterRpcGateway } from '../orchestration/createCommandApprovalHostPresenterRpcGateway';

const UUID = '018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d20';

describe('Command approval Host presenter RPC', () => {
  it('通过 Host 私有 pipe 投影 pending 并提交唯一审批终态', async () => {
    const approval = createCommandApprovalHost({ createUuid: () => UUID });
    approval.enableHostPresenter();
    const pair = createPeerPair(approval);
    const changed = vi.fn();
    pair.gateway.subscribe(changed);

    const request = approvalRequest();
    const result = approval.request({ request });
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    await expect(pair.gateway.read()).resolves.toMatchObject({
      pending: [{ approval_request_id: request.approval_request_id }],
    });
    await expect(pair.gateway.submit({
      approvalRequestId: request.approval_request_id,
      choice: 'allow_once',
    })).resolves.toEqual({ status: 'accepted' });
    await expect(result).resolves.toMatchObject({
      status: 'replied',
      reply: { choice: 'allow_once' },
    });

    pair.dispose();
  });

  it('parent gateway 严格拒绝错型 Backend response', async () => {
    const { gateway } = createCommandApprovalHostPresenterRpcGateway({
      rpc: { request: async () => ({ unexpected: true }) },
    });

    await expect(gateway.read()).rejects.toThrow();
    await expect(gateway.submit({
      approvalRequestId: approvalRequest().approval_request_id,
      choice: 'deny',
    })).rejects.toThrow();
  });
});

function createPeerPair(approval: ReturnType<typeof createCommandApprovalHost>) {
  const hostToBackend = new PassThrough();
  const backendToHost = new PassThrough();
  let hostPeer: AppServerRpcPeer | undefined;
  const host = createCommandApprovalHostPresenterRpcGateway({
    rpc: {
      request(method, payload, options) {
        if (!hostPeer) return Promise.reject(new Error('Host RPC peer 尚未创建'));
        return hostPeer.request(method, payload, options);
      },
    },
  });
  hostPeer = createAppServerRpcPeer({
    input: backendToHost,
    output: hostToBackend,
    handlers: host.notificationHandlers,
  });
  const backendPeer = createAppServerRpcPeer({
    input: hostToBackend,
    output: backendToHost,
    handlers: createCommandApprovalHostPresenterBackendRpcHandlers(approval),
  });
  const publisher = attachCommandApprovalHostPresenterPublisher({
    rpc: backendPeer,
    approval,
    onFailure(error) { throw error; },
  });
  return Object.freeze({
    gateway: host.gateway,
    dispose() {
      publisher.dispose();
      hostPeer?.dispose();
      backendPeer.dispose();
      hostToBackend.destroy();
      backendToHost.destroy();
    },
  });
}

function approvalRequest(): CommandApprovalRequestV1 {
  const identity = {
    conversation_id: 'conversation-host-rpc',
    agent_run_id: 'run-host-rpc',
    origin_tool_call_id: 'shell-call-host-rpc',
    command_execution_id: `command_execution_${UUID}`,
    owner_generation_id: `command_owner_${UUID}`,
    created_at_ms: 1_000,
  };
  return parseCommandApprovalRequest({
    protocol_version: 1,
    kind: 'command_approval_request',
    approval_request_id: `command_approval_${UUID}`,
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: 'rm file.txt',
      cwd: '/tmp/host-rpc',
      permission: {
        protocol_version: 1,
        kind: 'command_permission_snapshot',
        identity,
        base_level: 'standard',
        effective_level: 'standard',
        grant_source: 'global_setting',
        internal_data_access: 'allowed',
      },
    },
    reasons: [{ type: 'fixed_risk_rule', rule_id: 'delete.file', category: 'delete' }],
    available_choices: ['allow_once', 'deny'],
    requested_at_ms: 1_100,
  });
}

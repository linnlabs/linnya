import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';
import {
  CommandCardControlPageSnapshotV1Schema,
  parseCommandApprovalRequest,
  type CommandApprovalRequestV1,
} from '@app/schemas/commands';
import { createAppServerRpcPeer, type AppServerRpcPeer } from 'src/app-hosts/linnya/app-server-rpc';
import { createCommandApprovalHost } from '../../approval-host';
import type { CommandCardRendererControlPort } from '../../command-card-control-host';
import { createLocalCommandPermissionSettingsRendererGateway } from '../../permission-settings-authority';
import {
  DEFAULT_COMMAND_PERMISSION_SETTINGS,
  serializeCommandPermissionSettings,
} from 'src/domains/commands/features/permission-settings';
import { attachCommandRendererChangeRpcPublisher } from '../orchestration/attachCommandRendererChangeRpcPublisher';
import { createCommandBackendRpcHandlers } from '../orchestration/createCommandBackendRpcHandlers';
import { createCommandDesktopRpcGateways } from '../orchestration/createCommandDesktopRpcGateways';

const UUID = '018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d20';

describe('Command Renderer RPC', () => {
  it('设置、审批、卡片与受保护输入通过同一双向 typed RPC 往返', async () => {
    const approval = createCommandApprovalHost({ createUuid: () => UUID });
    const card = createCardFixture();
    let serialized = serializeCommandPermissionSettings(DEFAULT_COMMAND_PERMISSION_SETTINGS);
    const permissionSettings = createLocalCommandPermissionSettingsRendererGateway({
      read: () => ({ status: 'found', serialized }),
      write: next => {
        serialized = next;
        return { status: 'written' };
      },
    });
    const pair = createPeerPair({ approval, card, permissionSettings });

    await expect(pair.gateways.permissionSettings.read()).resolves.toMatchObject({
      success: true,
      settings: { revision: 0, permission_level: 'standard' },
    });
    await expect(pair.gateways.permissionSettings.update({
      schema_version: 1,
      kind: 'command_permission_settings_update',
      expected_revision: 0,
      permission_level: 'read_only',
      internal_data_access: 'denied',
    })).resolves.toMatchObject({
      success: true,
      settings: { revision: 1, permission_level: 'read_only' },
    });

    const page = await pair.gateways.approval.openRendererPage(41);
    if (!page) throw new Error('approval RPC page 未打开');
    const approvalChanged = vi.fn();
    pair.gateways.approval.subscribe(approvalChanged);
    const request = approvalRequest();
    const approvalResult = approval.request({ request });
    await vi.waitFor(() => expect(approvalChanged).toHaveBeenCalled());
    await expect(pair.gateways.approval.readRendererPage({
      ownerId: 41,
      pageTicket: page.page_ticket,
    })).resolves.toMatchObject({
      pending: [{ approval_request_id: request.approval_request_id }],
    });
    await expect(pair.gateways.approval.submitRendererReply({
      ownerId: 41,
      submission: {
        protocol_version: 1,
        kind: 'command_approval_reply_submission',
        page_ticket: page.page_ticket,
        approval_request_id: request.approval_request_id,
        choice: 'deny',
      },
    })).resolves.toEqual({ success: true, status: 'accepted' });
    await expect(approvalResult).resolves.toMatchObject({
      status: 'replied',
      reply: { choice: 'deny' },
    });

    const cardPage = await pair.gateways.card.openRendererPage(42, 'conversation-rpc');
    expect(cardPage).toEqual(card.snapshot);
    await expect(pair.gateways.card.cancel({
      ownerId: 42,
      submission: {
        page_ticket: card.snapshot.page_ticket,
        control_ticket: `command_control_ticket_${UUID}`,
      },
    })).resolves.toEqual({ status: 'stale' });
    await expect(pair.gateways.card.submitProtectedInput({
      ownerId: 42,
      submission: {
        page_ticket: card.snapshot.page_ticket,
        protected_input_ticket: `command_protected_input_ticket_${UUID}`,
        input: 'secret',
      },
    })).resolves.toEqual({ status: 'accepted' });

    pair.dispose();
  });

  it('卡片变化只保留一个 in-flight 和一个 dirty 通知', async () => {
    const approval = createCommandApprovalHost({ createUuid: () => UUID });
    const card = createCardFixture();
    const permissionSettings = createLocalCommandPermissionSettingsRendererGateway({
      read: () => ({
        status: 'found',
        serialized: serializeCommandPermissionSettings(DEFAULT_COMMAND_PERMISSION_SETTINGS),
      }),
      write: () => ({ status: 'written' }),
    });
    const pair = createPeerPair({ approval, card, permissionSettings });
    const changed = vi.fn();
    pair.gateways.card.subscribe(changed);

    for (let index = 0; index < 20; index += 1) card.notify();
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(changed.mock.calls.length).toBeLessThanOrEqual(2);

    pair.dispose();
  });

  it('Desktop client 严格拒绝错型 response', async () => {
    const failure = vi.fn();
    const gateways = createCommandDesktopRpcGateways({
      rpc: { request: async () => ({ unexpected: true }) },
      onAsyncFailure: failure,
    });

    await expect(gateways.permissionSettings.read()).rejects.toThrow();
    await expect(gateways.card.openRendererPage(1, 'conversation-rpc')).rejects.toThrow();
    expect(failure).not.toHaveBeenCalled();
  });
});

function createPeerPair(input: {
  readonly approval: ReturnType<typeof createCommandApprovalHost>;
  readonly card: ReturnType<typeof createCardFixture>;
  readonly permissionSettings: ReturnType<typeof createLocalCommandPermissionSettingsRendererGateway>;
}) {
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  let desktopPeer: AppServerRpcPeer | undefined;
  const gateways = createCommandDesktopRpcGateways({
    rpc: {
      request(method, payload, options) {
        if (!desktopPeer) return Promise.reject(new Error('Desktop RPC peer 尚未创建'));
        return desktopPeer.request(method, payload, options);
      },
    },
    onAsyncFailure(error) {
      throw error;
    },
  });
  desktopPeer = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers: gateways.notificationHandlers,
  });
  const backendPeer = createAppServerRpcPeer({
    input: desktopToBackend,
    output: backendToDesktop,
    handlers: createCommandBackendRpcHandlers(input),
  });
  const publisher = attachCommandRendererChangeRpcPublisher({
    rpc: backendPeer,
    approval: input.approval,
    card: input.card,
    onFailure(error) {
      throw error;
    },
  });
  return {
    gateways,
    dispose() {
      publisher.dispose();
      desktopPeer?.dispose();
      backendPeer.dispose();
      desktopToBackend.destroy();
      backendToDesktop.destroy();
    },
  };
}

function createCardFixture() {
  const listeners = new Set<() => void>();
  const snapshot = CommandCardControlPageSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'command_card_control_page_snapshot',
    page_ticket: `command_control_page_${UUID}`,
    conversation_id: 'conversation-rpc',
    capabilities: [],
    settlements: [],
    settlement_failures: [],
    audit_failures: [],
  });
  const card: CommandCardRendererControlPort = {
    openRendererPage: async () => snapshot,
    readRendererPage: async () => snapshot,
    invalidateRendererPage: () => undefined,
    cancel: async () => ({ status: 'stale' }),
    submitProtectedInput: async () => ({ status: 'accepted' }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return Object.freeze({
    ...card,
    snapshot,
    notify() {
      for (const listener of listeners) listener();
    },
  });
}

function approvalRequest(): CommandApprovalRequestV1 {
  const identity = {
    conversation_id: 'conversation-rpc',
    agent_run_id: 'run-rpc',
    origin_tool_call_id: 'shell-call-rpc',
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
      cwd: '/tmp/rpc',
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

import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_CONTROL_BRIDGE_PATH,
  ConversationControlErrorResponseSchema,
  ConversationControlHandshakeResponseSchema,
  ConversationControlStatusResponseSchema,
} from '@app/schemas';
import {
  ConversationControlError,
  type ConversationControlUseCase,
} from 'src/app-hosts/linnya/application/conversation-control';
import { createConversationControlBridgeRouter } from '../conversationControlBridge.router';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
});

async function startBridge(useCase: ConversationControlUseCase): Promise<string> {
  const app = express();
  app.use(CONVERSATION_CONTROL_BRIDGE_PATH, createConversationControlBridgeRouter({
    useCase,
    appInstanceId: 'app-instance-1',
    appVersion: '1.2.3',
    diagnostics: { error: vi.fn() },
  }));
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server address is unavailable');
  return `http://127.0.0.1:${address.port}${CONVERSATION_CONTROL_BRIDGE_PATH}`;
}

function createUseCase(
  execute: ConversationControlUseCase['execute'],
): ConversationControlUseCase {
  const unused = async (): Promise<never> => {
    throw new Error('Direct use-case method is not used by the bridge');
  };
  return {
    execute,
    send: unused,
    models: unused,
    list: unused,
    messages: unused,
    status: unused,
    respond: unused,
    stop: unused,
    result: unused,
    audit: unused,
    workspaceTools: unused,
  };
}

async function postJson(baseUrl: string, suffix: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${suffix}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('conversation-control bridge router', () => {
  it('握手声明 Host 已实现的 conversation control 能力', async () => {
    const baseUrl = await startBridge(createUseCase(vi.fn()));
    const response = await postJson(baseUrl, '/handshake', {
      protocol_version: 1,
      client_name: 'linnya-cli',
      client_version: '0.1.0',
    });
    expect(response.status).toBe(200);
    const handshake = ConversationControlHandshakeResponseSchema.parse(await response.json());
    expect(handshake.app_instance_id).toBe('app-instance-1');
    expect(handshake.capabilities).toContain('send');
    expect(handshake.capabilities).toContain('models');
    expect(handshake.capabilities).toContain('audit');
    expect(handshake.capabilities).toContain('workspace_tools');
  });

  it('严格解析命令并投影工作流响应', async () => {
    const execute = vi.fn<ConversationControlUseCase['execute']>(async request => ({
      schema_version: 1,
      ok: true,
      command: 'status',
      conversation_id: request.command === 'status' ? request.conversation_id : 'unexpected',
      run: null,
    }));
    const baseUrl = await startBridge(createUseCase(execute));
    const response = await postJson(baseUrl, '/commands', {
      schema_version: 1,
      command: 'status',
      conversation_id: 'conversation-1',
    });
    expect(response.status).toBe(200);
    expect(ConversationControlStatusResponseSchema.parse(await response.json())).toMatchObject({
      conversation_id: 'conversation-1',
      run: null,
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('业务冲突与非法 JSON 都返回稳定错误合同', async () => {
    const execute: ConversationControlUseCase['execute'] = async () => {
      throw new ConversationControlError('conversation_busy', 'Conversation is busy', true);
    };
    const baseUrl = await startBridge(createUseCase(execute));
    const conflict = await postJson(baseUrl, '/commands', {
      schema_version: 1,
      command: 'status',
      conversation_id: 'conversation-1',
    });
    expect(conflict.status).toBe(409);
    expect(ConversationControlErrorResponseSchema.parse(await conflict.json())).toMatchObject({
      error: { code: 'conversation_busy', retryable: true },
    });

    const malformed = await fetch(`${baseUrl}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(ConversationControlErrorResponseSchema.parse(await malformed.json())).toMatchObject({
      error: { code: 'invalid_request' },
    });
  });
});

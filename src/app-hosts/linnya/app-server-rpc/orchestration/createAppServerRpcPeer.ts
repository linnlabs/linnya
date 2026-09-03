import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';

import { JsonValueSchema, type JsonValue } from '@app/schemas';

import {
  APP_SERVER_RPC_DEFAULT_TIMEOUT_MS,
  APP_SERVER_RPC_MAX_FRAME_BYTES,
  APP_SERVER_RPC_MAX_PENDING_REQUESTS,
  APP_SERVER_RPC_SCHEMA_VERSION,
  type AppServerRpcFailureFrame,
  type AppServerRpcFrame,
} from '../definitions/appServerRpcProtocol';
import type {
  AppServerRpcHandlerRegistry,
  AppServerRpcPeer,
} from '../definitions/appServerRpcPeer';
import { parseAppServerRpcFrame } from '../functions/appServerRpcCodec';
import { createAppServerRpcWriter } from '../functions/createAppServerRpcWriter';
import { createBoundedJsonLineDecoder } from '../../app-server-transport';

interface PendingOutboundRequest {
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
  readonly removeAbortListener: () => void;
}

interface ActiveInboundRequest {
  readonly controller: AbortController;
}

export function createAppServerRpcPeer(input: {
  readonly input: Readable;
  readonly output: Writable;
  readonly handlers: AppServerRpcHandlerRegistry;
  readonly requestIdFactory?: { create(): string };
}): AppServerRpcPeer {
  const requestIdFactory = input.requestIdFactory ?? { create: randomUUID };
  const pendingOutbound = new Map<string, PendingOutboundRequest>();
  const activeInbound = new Map<string, ActiveInboundRequest>();
  const ignoredOutboundResponses = new Map<string, NodeJS.Timeout>();
  const recentInboundTerminal = new Set<string>();
  let disposed = false;
  let completedResolve: (() => void) | null = null;
  let completedReject: ((error: Error) => void) | null = null;
  const completed = new Promise<void>((resolve, reject) => {
    completedResolve = resolve;
    completedReject = reject;
  });

  const dispose = (reason = new Error('App Server RPC peer 已关闭')): void => {
    if (disposed) return;
    disposed = true;
    for (const pending of pendingOutbound.values()) {
      clearTimeout(pending.timeout);
      pending.removeAbortListener();
      pending.reject(reason);
    }
    pendingOutbound.clear();
    for (const request of activeInbound.values()) request.controller.abort(reason);
    activeInbound.clear();
    for (const timeout of ignoredOutboundResponses.values()) clearTimeout(timeout);
    ignoredOutboundResponses.clear();
    completedResolve?.();
  };

  const fail = (error: unknown): void => {
    const failure = toError(error);
    if (disposed) return;
    disposed = true;
    for (const pending of pendingOutbound.values()) {
      clearTimeout(pending.timeout);
      pending.removeAbortListener();
      pending.reject(failure);
    }
    pendingOutbound.clear();
    for (const request of activeInbound.values()) request.controller.abort(failure);
    activeInbound.clear();
    for (const timeout of ignoredOutboundResponses.values()) clearTimeout(timeout);
    ignoredOutboundResponses.clear();
    completedReject?.(failure);
  };

  const writer = createAppServerRpcWriter({
    output: input.output,
    onFailure: fail,
  });

  const writeFailure = (
    requestId: string,
    code: AppServerRpcFailureFrame['error']['code'],
    message: string,
  ): Promise<void> => writer.write({
    schema_version: APP_SERVER_RPC_SCHEMA_VERSION,
    kind: 'response',
    request_id: requestId,
    ok: false,
    error: { code, message: limitErrorMessage(message) },
  }, 'urgent');

  const rememberInboundTerminal = (requestId: string): void => {
    recentInboundTerminal.add(requestId);
    if (recentInboundTerminal.size > APP_SERVER_RPC_MAX_PENDING_REQUESTS * 2) {
      const oldest = recentInboundTerminal.values().next().value;
      if (typeof oldest === 'string') recentInboundTerminal.delete(oldest);
    }
  };

  const handleRequest = (frame: Extract<AppServerRpcFrame, { kind: 'request' }>): void => {
    if (activeInbound.has(frame.request_id) || recentInboundTerminal.has(frame.request_id)) {
      fail(new Error(`App Server RPC request_id 重复: ${frame.request_id}`));
      return;
    }
    const handler = input.handlers.get(frame.method);
    if (!handler) {
      rememberInboundTerminal(frame.request_id);
      void writeFailure(frame.request_id, 'method_not_registered', `RPC method 未注册: ${frame.method}`)
        .catch(fail);
      return;
    }
    if (activeInbound.size >= APP_SERVER_RPC_MAX_PENDING_REQUESTS) {
      rememberInboundTerminal(frame.request_id);
      void writeFailure(frame.request_id, 'handler_capacity_exceeded', 'RPC handler 已达容量上限')
        .catch(fail);
      return;
    }
    const controller = new AbortController();
    const active: ActiveInboundRequest = { controller };
    activeInbound.set(frame.request_id, active);
    void Promise.resolve().then(() => handler(frame.payload, {
      requestId: frame.request_id,
      signal: controller.signal,
    })).then(async result => {
      if (activeInbound.get(frame.request_id) !== active) return;
      activeInbound.delete(frame.request_id);
      rememberInboundTerminal(frame.request_id);
      await writer.write({
        schema_version: APP_SERVER_RPC_SCHEMA_VERSION,
        kind: 'response',
        request_id: frame.request_id,
        ok: true,
        result: JsonValueSchema.parse(result),
      }, 'urgent');
    }, async (error: unknown) => {
      if (activeInbound.get(frame.request_id) !== active) return;
      activeInbound.delete(frame.request_id);
      rememberInboundTerminal(frame.request_id);
      await writeFailure(frame.request_id, 'handler_failed', toError(error).message);
    }).catch(fail);
  };

  const handleResponse = (frame: Extract<AppServerRpcFrame, { kind: 'response' }>): void => {
    const ignoredTimeout = ignoredOutboundResponses.get(frame.request_id);
    if (ignoredTimeout) {
      clearTimeout(ignoredTimeout);
      ignoredOutboundResponses.delete(frame.request_id);
      return;
    }
    const pending = pendingOutbound.get(frame.request_id);
    if (!pending) {
      fail(new Error(`App Server RPC response 没有匹配 request: ${frame.request_id}`));
      return;
    }
    pendingOutbound.delete(frame.request_id);
    clearTimeout(pending.timeout);
    pending.removeAbortListener();
    if (frame.ok) {
      pending.resolve(frame.result);
      return;
    }
    pending.reject(new Error(`App Server RPC ${frame.error.code}: ${frame.error.message}`));
  };

  const handleCancel = (requestId: string): void => {
    const active = activeInbound.get(requestId);
    if (!active) {
      if (recentInboundTerminal.has(requestId)) return;
      fail(new Error(`App Server RPC cancel 没有匹配 request: ${requestId}`));
      return;
    }
    activeInbound.delete(requestId);
    active.controller.abort(new Error('App Server RPC request cancelled'));
    rememberInboundTerminal(requestId);
    void writeFailure(requestId, 'cancelled', 'RPC request 已取消').catch(fail);
  };

  const decoder = createBoundedJsonLineDecoder({
    protocolName: 'App Server RPC protocol',
    maxFrameBytes: APP_SERVER_RPC_MAX_FRAME_BYTES,
    onValue(value) {
      if (disposed) return;
      let frame: AppServerRpcFrame;
      try {
        frame = parseAppServerRpcFrame(value);
      } catch (error: unknown) {
        fail(error);
        return;
      }
      if (frame.kind === 'request') {
        handleRequest(frame);
      } else if (frame.kind === 'response') {
        handleResponse(frame);
      } else {
        handleCancel(frame.request_id);
      }
    },
    onFailure: fail,
  });

  input.input.on('data', (chunk: unknown) => {
    if (Buffer.isBuffer(chunk) || typeof chunk === 'string') {
      decoder.push(chunk);
      return;
    }
    fail(new Error('App Server RPC input 只能传输 bytes'));
  });
  input.input.once('end', () => {
    decoder.end();
    if (!disposed) fail(new Error('App Server RPC input 已关闭'));
  });
  input.input.once('error', fail);

  const request = (
    method: string,
    payload: JsonValue,
    options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
  ): Promise<JsonValue> => {
    if (disposed) return Promise.reject(new Error('App Server RPC peer 已关闭'));
    if (pendingOutbound.size >= APP_SERVER_RPC_MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error('App Server RPC pending request 已达容量上限'));
    }
    const timeoutMs = options.timeoutMs ?? APP_SERVER_RPC_DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error('App Server RPC timeoutMs 必须是正整数'));
    }
    try {
      options.signal?.throwIfAborted();
      JsonValueSchema.parse(payload);
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }
    const requestId = requestIdFactory.create();
    if (pendingOutbound.has(requestId) || ignoredOutboundResponses.has(requestId)) {
      return Promise.reject(new Error(`App Server RPC request id 重复: ${requestId}`));
    }
    return new Promise<JsonValue>((resolve, reject) => {
      const rememberIgnoredResponse = (): void => {
        const cleanup = setTimeout(() => {
          ignoredOutboundResponses.delete(requestId);
        }, timeoutMs);
        ignoredOutboundResponses.set(requestId, cleanup);
      };
      const cancel = (message: string): void => {
        const pending = pendingOutbound.get(requestId);
        if (!pending) return;
        pendingOutbound.delete(requestId);
        clearTimeout(pending.timeout);
        pending.removeAbortListener();
        rememberIgnoredResponse();
        pending.reject(new Error(message));
        void writer.write({
          schema_version: APP_SERVER_RPC_SCHEMA_VERSION,
          kind: 'cancel',
          request_id: requestId,
        }, 'urgent').catch(fail);
      };
      const abort = (): void => cancel(`App Server RPC ${method} 已取消`);
      const timeout = setTimeout(() => {
        cancel(`App Server RPC ${method} 超时（${timeoutMs}ms）`);
      }, timeoutMs);
      pendingOutbound.set(requestId, {
        resolve,
        reject,
        timeout,
        removeAbortListener: () => options.signal?.removeEventListener('abort', abort),
      });
      options.signal?.addEventListener('abort', abort, { once: true });
      void writer.write({
        schema_version: APP_SERVER_RPC_SCHEMA_VERSION,
        kind: 'request',
        request_id: requestId,
        method,
        payload,
      }, 'normal').catch((error: unknown) => {
        const pending = pendingOutbound.get(requestId);
        if (pending) {
          pendingOutbound.delete(requestId);
          clearTimeout(pending.timeout);
          pending.removeAbortListener();
          pending.reject(toError(error));
        }
        fail(error);
      });
      if (options.signal?.aborted) abort();
    });
  };

  return Object.freeze({ completed, request, dispose });
}

function limitErrorMessage(message: string): string {
  const normalized = message.length > 0 ? message : 'unknown RPC failure';
  return normalized.slice(0, 2_048);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

import { describe, expect, it, vi } from 'vitest';

import {
  WindowClosePreparationResultMessageSchema,
  WindowCloseRendererReadyMessageSchema,
  WindowCloseRequestIdSchema,
  type WindowCloseRequestMessage,
} from '../../../shared/app-lifecycle/definitions/windowCloseProtocol';
import { createWindowClosePreparationHost } from './createWindowClosePreparationHost';

const firstSession = WindowCloseRendererReadyMessageSchema.parse({
  schema_version: 1,
  kind: 'window_close_renderer_ready',
  renderer_session_id: 'c371b5a2-ed26-43ca-9297-85b95b419e78',
});
const secondSession = WindowCloseRendererReadyMessageSchema.parse({
  schema_version: 1,
  kind: 'window_close_renderer_ready',
  renderer_session_id: '5f44f20a-a513-4a71-b423-139d58e16e2d',
});

function createFixture() {
  const requestIds = [
    WindowCloseRequestIdSchema.parse('f5849297-280b-4e4a-8aa0-962217bc9fe1'),
    WindowCloseRequestIdSchema.parse('16430954-468f-4610-be4d-fe09757a4a15'),
  ];
  const sendRequest = vi.fn();
  const host = createWindowClosePreparationHost(42, {
    createRequest: identity => ({
      schema_version: 1,
      kind: 'window_close_request',
      renderer_session_id: identity.rendererSessionId,
      request_id: requestIds.shift() ?? WindowCloseRequestIdSchema.parse(crypto.randomUUID()),
    }),
    sendRequest,
  });
  return { host, sendRequest };
}

function resultFor(
  request: WindowCloseRequestMessage,
  result: 'ready' | 'save_failed',
) {
  return WindowClosePreparationResultMessageSchema.parse({
    schema_version: 1,
    kind: 'window_close_preparation_result',
    renderer_session_id: request.renderer_session_id,
    request_id: request.request_id,
    result,
  });
}

describe('createWindowClosePreparationHost', () => {
  it('renderer 就绪前关闭会等待，握手后只发送一次请求', async () => {
    const { host, sendRequest } = createFixture();
    const preparation = host.prepare();
    expect(sendRequest).not.toHaveBeenCalled();

    host.markRendererReady(firstSession);
    expect(sendRequest).toHaveBeenCalledOnce();
    const request = sendRequest.mock.calls[0][0];
    host.markRendererReady(firstSession);
    expect(sendRequest).toHaveBeenCalledOnce();

    host.resolvePreparation(resultFor(request, 'ready'));
    await expect(preparation).resolves.toBeUndefined();
  });

  it('错误页面会话或错误请求编号不能完成当前保存屏障', async () => {
    const { host, sendRequest } = createFixture();
    host.markRendererReady(firstSession);
    const preparation = host.prepare();
    const request = sendRequest.mock.calls[0][0];
    let settled = false;
    void preparation.finally(() => { settled = true; });

    host.resolvePreparation(WindowClosePreparationResultMessageSchema.parse({
      ...resultFor(request, 'ready'),
      renderer_session_id: secondSession.renderer_session_id,
    }));
    host.resolvePreparation(WindowClosePreparationResultMessageSchema.parse({
      ...resultFor(request, 'ready'),
      request_id: '398f3db0-2039-4bd1-816d-76c0ed934f89',
    }));
    await Promise.resolve();
    expect(settled).toBe(false);

    host.resolvePreparation(resultFor(request, 'ready'));
    await expect(preparation).resolves.toBeUndefined();
  });

  it('请求发出后页面切换会明确失败，新页面就绪后允许重试', async () => {
    const { host, sendRequest } = createFixture();
    host.markRendererReady(firstSession);
    const first = host.prepare();
    const staleRequest = sendRequest.mock.calls[0][0];
    host.invalidateRenderer();
    await expect(first).rejects.toThrow('页面已切换');

    const second = host.prepare();
    host.resolvePreparation(resultFor(staleRequest, 'ready'));
    expect(sendRequest).toHaveBeenCalledOnce();
    host.markRendererReady(secondSession);
    expect(sendRequest).toHaveBeenCalledTimes(2);
    const currentRequest = sendRequest.mock.calls[1][0];
    host.resolvePreparation(resultFor(currentRequest, 'ready'));
    await expect(second).resolves.toBeUndefined();
  });

  it('renderer 崩溃或窗口销毁时继续 App owner 收口，不永久等待', async () => {
    const { host } = createFixture();
    const preparation = host.prepare();
    host.rendererUnavailable();
    await expect(preparation).resolves.toBeUndefined();
  });

  it('保存失败保持窗口，并允许下一次关闭重新请求', async () => {
    const { host, sendRequest } = createFixture();
    host.markRendererReady(firstSession);
    const first = host.prepare();
    host.resolvePreparation(resultFor(sendRequest.mock.calls[0][0], 'save_failed'));
    await expect(first).rejects.toThrow('未能保存');

    const second = host.prepare();
    host.resolvePreparation(resultFor(sendRequest.mock.calls[1][0], 'ready'));
    await expect(second).resolves.toBeUndefined();
  });

  it('向仍存在但已经不可发送的页面投递失败时结算请求并允许重试', async () => {
    const sendFailure = new Error('frame detached');
    const sendRequest = vi.fn()
      .mockImplementationOnce(() => { throw sendFailure; })
      .mockImplementationOnce(() => undefined);
    const host = createWindowClosePreparationHost(42, {
      createRequest: identity => ({
        schema_version: 1,
        kind: 'window_close_request',
        renderer_session_id: identity.rendererSessionId,
        request_id: WindowCloseRequestIdSchema.parse(crypto.randomUUID()),
      }),
      sendRequest,
    });
    host.markRendererReady(firstSession);

    await expect(host.prepare()).rejects.toBe(sendFailure);
    const retry = host.prepare();
    expect(sendRequest).toHaveBeenCalledTimes(2);
    host.resolvePreparation(resultFor(sendRequest.mock.calls[1][0], 'ready'));
    await expect(retry).resolves.toBeUndefined();
  });
});

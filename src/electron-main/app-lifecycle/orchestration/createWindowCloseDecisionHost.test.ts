import { describe, expect, it, vi } from 'vitest';
import {
  WindowCloseRendererReadyMessageSchema,
  WindowCloseRequestIdSchema,
  type WindowCloseDecisionRequestMessage,
  type WindowClosePrompt,
} from '../../../shared/app-lifecycle/definitions/windowCloseProtocol';
import { createWindowCloseDecisionHost } from './createWindowCloseDecisionHost';

const ready = WindowCloseRendererReadyMessageSchema.parse({
  schema_version: 1,
  kind: 'window_close_renderer_ready',
  renderer_session_id: 'c371b5a2-ed26-43ca-9297-85b95b419e78',
});
const prompt: WindowClosePrompt = { kind: 'running_tasks', has_executing_commands: false, scheduled_running_count: 1 };

function createFixture() {
  const sent: WindowCloseDecisionRequestMessage[] = [];
  const sendDismiss = vi.fn();
  const timeouts: Array<{ fire: () => void; cancelled: boolean }> = [];
  const host = createWindowCloseDecisionHost({
    createRequest: (rendererSessionId, requested) => ({
      schema_version: 1,
      kind: 'window_close_decision_request',
      renderer_session_id: rendererSessionId,
      request_id: WindowCloseRequestIdSchema.parse(crypto.randomUUID()),
      prompt: requested,
    }),
    sendRequest: message => { sent.push(message); },
    sendDismiss,
    startPresentationTimeout: onTimeout => {
      const timeout = { fire: onTimeout, cancelled: false };
      timeouts.push(timeout);
      return () => { timeout.cancelled = true; };
    },
  });
  const requestAt = (index: number) => {
    const message = sent[index];
    if (!message) throw new Error(`request ${index} was not sent`);
    return message;
  };
  const presented = (message: WindowCloseDecisionRequestMessage) => host.markPresented({
    schema_version: 1, kind: 'window_close_decision_presented',
    renderer_session_id: message.renderer_session_id, request_id: message.request_id,
  });
  const decide = (message: WindowCloseDecisionRequestMessage, decision: 'return' | 'proceed') => host.resolveDecision({
    schema_version: 1, kind: 'window_close_decision_result',
    renderer_session_id: message.renderer_session_id, request_id: message.request_id, decision,
  });
  return { host, sent, requestAt, sendDismiss, timeouts, presented, decide };
}

describe('createWindowCloseDecisionHost', () => {
  it('界面还没就绪时直接交给系统框，不发请求', async () => {
    const { host, sent } = createFixture();
    await expect(host.ask(prompt)).resolves.toBe('unavailable');
    expect(sent).toEqual([]);
  });

  it('弹窗画出来以后一直等用户，答复原样返回', async () => {
    const { host, requestAt, timeouts, presented, decide, sendDismiss } = createFixture();
    host.markRendererReady(ready);
    const answer = host.ask(prompt);
    expect(requestAt(0).prompt).toEqual(prompt);
    presented(requestAt(0));
    expect(timeouts[0]?.cancelled).toBe(true);
    decide(requestAt(0), 'proceed');
    await expect(answer).resolves.toBe('proceed');
    expect(sendDismiss).not.toHaveBeenCalled();

    const second = host.ask(prompt);
    decide(requestAt(1), 'return');
    await expect(second).resolves.toBe('return');
  });

  it('迟迟没有画出来就改用系统框，并让界面收起迟到的弹窗', async () => {
    const { host, requestAt, timeouts, decide, sendDismiss } = createFixture();
    host.markRendererReady(ready);
    const answer = host.ask(prompt);
    timeouts[0]?.fire();
    await expect(answer).resolves.toBe('unavailable');
    expect(sendDismiss).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ request_id: requestAt(0).request_id }));
    // 迟到的答复不影响下一次询问。
    const next = host.ask(prompt);
    decide(requestAt(0), 'proceed');
    decide(requestAt(1), 'return');
    await expect(next).resolves.toBe('return');
  });

  it('等待用户期间界面没有响应或消失，改用系统框', async () => {
    const { host, requestAt, presented, sendDismiss } = createFixture();
    host.markRendererReady(ready);
    const hung = host.ask(prompt);
    presented(requestAt(0));
    host.rendererUnresponsive();
    await expect(hung).resolves.toBe('unavailable');
    expect(sendDismiss).toHaveBeenCalledOnce();

    const gone = host.ask(prompt);
    host.rendererUnavailable();
    await expect(gone).resolves.toBe('unavailable');
    // 页面换了，要等新页面声明就绪。
    await expect(host.ask(prompt)).resolves.toBe('unavailable');
  });

  it('旧页面的回应不能回答新页面的询问', async () => {
    const { host, requestAt, decide } = createFixture();
    host.markRendererReady(ready);
    const answer = host.ask(prompt);
    decide({
      ...requestAt(0),
      renderer_session_id: WindowCloseRendererReadyMessageSchema.parse({
        ...ready, renderer_session_id: '5f44f20a-a513-4a71-b423-139d58e16e2d',
      }).renderer_session_id,
    }, 'proceed');
    decide(requestAt(0), 'return');
    await expect(answer).resolves.toBe('return');
  });

  it('发送失败改用系统框', async () => {
    const host = createWindowCloseDecisionHost({
      createRequest: (rendererSessionId, requested) => ({
        schema_version: 1, kind: 'window_close_decision_request', renderer_session_id: rendererSessionId,
        request_id: WindowCloseRequestIdSchema.parse(crypto.randomUUID()), prompt: requested,
      }),
      sendRequest: () => { throw new Error('webContents destroyed'); },
      sendDismiss: vi.fn(),
      startPresentationTimeout: () => () => undefined,
    });
    host.markRendererReady(ready);
    await expect(host.ask(prompt)).resolves.toBe('unavailable');
  });
});

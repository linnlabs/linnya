import type {
  WindowCloseDecisionAnswer,
  WindowCloseDecisionHost,
  WindowCloseDecisionHostPorts,
} from '../definitions/windowCloseDecisionHost';
import type {
  WindowCloseDecisionRequestMessage,
  WindowCloseRendererSessionId,
} from '../../../shared/app-lifecycle/definitions/windowCloseProtocol';

interface PendingDecision {
  readonly request: WindowCloseDecisionRequestMessage;
  readonly resolve: (answer: WindowCloseDecisionAnswer) => void;
  readonly cancelTimeout: () => void;
}

/**
 * 在应用内问用户要不要退出。界面卡住时应用内的弹窗点不动，用户就退不出去，所以只有确认弹窗已经画出来才等用户；
 * 等待期间界面消失或没有响应，也立即交回调用方改用系统框。用户想多久都可以，这里不限时。
 */
export function createWindowCloseDecisionHost(ports: WindowCloseDecisionHostPorts): WindowCloseDecisionHost {
  let readySession: WindowCloseRendererSessionId | undefined;
  let pending: PendingDecision | undefined;

  function settle(answer: WindowCloseDecisionAnswer): void {
    const current = pending;
    if (!current) return;
    pending = undefined;
    current.cancelTimeout();
    current.resolve(answer);
  }

  /** 界面可能只是慢：先让它收起弹窗，免得和系统框同时出现。 */
  function fallBack(): void {
    const current = pending;
    if (!current) return;
    ports.sendDismiss({
      schema_version: 1,
      kind: 'window_close_decision_dismiss',
      renderer_session_id: current.request.renderer_session_id,
      request_id: current.request.request_id,
    });
    settle('unavailable');
  }

  function isCurrent(message: Pick<WindowCloseDecisionRequestMessage, 'renderer_session_id' | 'request_id'>): boolean {
    return pending?.request.renderer_session_id === message.renderer_session_id
      && pending.request.request_id === message.request_id;
  }

  return Object.freeze<WindowCloseDecisionHost>({
    markRendererReady(message) {
      readySession = message.renderer_session_id;
    },

    rendererUnavailable() {
      readySession = undefined;
      settle('unavailable');
    },

    rendererUnresponsive: fallBack,

    markPresented(message) {
      if (isCurrent(message)) pending?.cancelTimeout();
    },

    resolveDecision(message) {
      if (isCurrent(message)) settle(message.decision);
    },

    ask(prompt) {
      if (!readySession || pending) return Promise.resolve('unavailable');
      const request = ports.createRequest(readySession, prompt);
      return new Promise<WindowCloseDecisionAnswer>(resolve => {
        pending = { request, resolve, cancelTimeout: ports.startPresentationTimeout(fallBack) };
        try {
          ports.sendRequest(request);
        } catch {
          settle('unavailable');
        }
      });
    },
  });
}

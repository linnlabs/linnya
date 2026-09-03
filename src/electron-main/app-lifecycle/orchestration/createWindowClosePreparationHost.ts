import type {
  WindowClosePreparationHost,
  WindowClosePreparationHostPorts,
  WindowCloseRendererIdentity,
} from '../definitions/windowClosePreparationHost';
import type {
  WindowClosePreparationResultMessage,
  WindowCloseRendererReadyMessage,
  WindowCloseRequestMessage,
} from '../../../shared/app-lifecycle/definitions/windowCloseProtocol';

interface PendingPreparation {
  request?: WindowCloseRequestMessage;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

/**
 * renderer 就绪和关闭保存之间没有超时：慢启动、慢磁盘都不是失败。页面一旦在请求发出后切换，
 * 旧页面的保存结论就失去意义，因此明确失败并保留窗口，由用户在新页面就绪后重新关闭。
 */
export function createWindowClosePreparationHost(
  webContentsId: number,
  ports: WindowClosePreparationHostPorts,
): WindowClosePreparationHost {
  let readyIdentity: WindowCloseRendererIdentity | undefined;
  let pending: PendingPreparation | undefined;

  function sendWhenReady(): void {
    if (!pending || pending.request || !readyIdentity) return;
    const current = pending;
    current.request = ports.createRequest(readyIdentity);
    try {
      ports.sendRequest(current.request);
    } catch (error: unknown) {
      if (pending === current) pending = undefined;
      current.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function settleUnavailable(): void {
    const current = pending;
    pending = undefined;
    readyIdentity = undefined;
    current?.resolve();
  }

  return Object.freeze({
    markRendererReady(message: WindowCloseRendererReadyMessage) {
      readyIdentity = {
        webContentsId,
        rendererSessionId: message.renderer_session_id,
      };
      sendWhenReady();
    },

    invalidateRenderer() {
      readyIdentity = undefined;
      if (!pending?.request) return;
      const current = pending;
      pending = undefined;
      current.reject(new Error('renderer 页面已切换，窗口关闭请求已失效'));
    },

    resolvePreparation(message: WindowClosePreparationResultMessage) {
      const current = pending;
      if (!current?.request) return;
      if (message.renderer_session_id !== current.request.renderer_session_id) return;
      if (message.request_id !== current.request.request_id) return;
      pending = undefined;
      if (message.result === 'ready') {
        current.resolve();
        return;
      }
      current.reject(new Error('renderer 未能保存当前文档，窗口保持打开'));
    },

    rendererUnavailable: settleUnavailable,

    prepare() {
      if (pending) throw new Error('窗口关闭保存请求已经在进行中');
      return new Promise<void>((resolve, reject) => {
        pending = { resolve, reject };
        sendWhenReady();
      });
    },
  });
}

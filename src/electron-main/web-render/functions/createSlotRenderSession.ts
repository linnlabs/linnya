import type {
  WebPageRenderMainFrameResponse,
  WebPageRenderResponseDecision,
  WebPageRenderRuntime,
  WebPageRenderSession,
  WebPageRenderSubresourceEvent,
} from '../definitions/webPageRenderRuntime';

type MainFrameResponseListener = (response: WebPageRenderMainFrameResponse) => WebPageRenderResponseDecision;
type SubresourceListener = (event: WebPageRenderSubresourceEvent) => void;

export interface SlotRenderSession {
  borrow(): WebPageRenderSession;
  dispose(): void;
}

/**
 * Electron 对同一 `partition` 的 `session.fromPartition` 持久复用底层实例且每类 `webRequest`
 * 只保留一个回调。安全守卫与响应观察器必须按槽位安装一次并随槽位存活，Worker 空闲销毁
 * 时只重置当前回调指针、清空存储，不能卸载槽位 SSRF/权限/下载防线。
 */
export function createSlotRenderSession(
  runtime: WebPageRenderRuntime,
  partition: string,
): SlotRenderSession {
  const underlying = runtime.createSession(partition);
  const removeSecurityGuards = underlying.installSecurityGuards();
  let activeResponseListener: MainFrameResponseListener | null = null;
  let activeSubresourceListener: SubresourceListener | null = null;
  let disposed = false;

  const removeResponseObserver = underlying.observeMainFrameResponses((response) => {
    if (disposed || !activeResponseListener) return 'cancel';
    return activeResponseListener(response);
  });
  const removeSubresourceObserver = underlying.observeSubresources((event) => {
    if (disposed || !activeSubresourceListener) return;
    activeSubresourceListener(event);
  });

  const borrowedSession: WebPageRenderSession = {
    clearStorageData: () => underlying.clearStorageData(),
    // 槽位在底层 session 上持久持有权限/下载/URL+DNS 准入守卫；Worker 销毁不能卸载它。
    installSecurityGuards: () => () => undefined,
    observeMainFrameResponses: (listener) => {
      activeResponseListener = listener;
      return () => {
        if (activeResponseListener === listener) activeResponseListener = null;
      };
    },
    observeSubresources: (listener) => {
      activeSubresourceListener = listener;
      return () => {
        if (activeSubresourceListener === listener) activeSubresourceListener = null;
      };
    },
  };

  return {
    borrow: () => borrowedSession,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      activeResponseListener = null;
      activeSubresourceListener = null;
      removeSubresourceObserver();
      removeResponseObserver();
      removeSecurityGuards();
    },
  };
}

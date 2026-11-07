import { shallowRef } from 'vue';

/** 打开文档要等布局切换完成；超过这个时间仍没切到目标文档就作废，避免以后误弹。 */
const REQUEST_TTL_MS = 10_000;

interface DocumentHistoryPanelRequest {
  readonly documentId: string;
  readonly requestedAt: number;
}

const pendingRequest = shallowRef<DocumentHistoryPanelRequest | null>(null);

/** 其他界面（例如对话里的改动清单）请求在目标文档打开后显示它的文档历史。 */
export function requestDocumentHistoryPanel(documentId: string): void {
  pendingRequest.value = { documentId, requestedAt: Date.now() };
}

export function cancelDocumentHistoryPanelRequest(documentId: string): void {
  if (pendingRequest.value?.documentId === documentId) pendingRequest.value = null;
}

/** 顶栏在当前文档就是目标、且该类型提供历史时消费请求；一次请求只打开一次。 */
export function consumeDocumentHistoryPanelRequest(activeDocumentId: string | null): boolean {
  const request = pendingRequest.value;
  if (!request) return false;
  if (Date.now() - request.requestedAt > REQUEST_TTL_MS) {
    pendingRequest.value = null;
    return false;
  }
  if (request.documentId !== activeDocumentId) return false;
  pendingRequest.value = null;
  return true;
}

export function useDocumentHistoryPanelRequest() {
  return pendingRequest;
}

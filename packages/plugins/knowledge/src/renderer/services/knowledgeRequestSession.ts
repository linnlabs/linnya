import { resolveKnowledgeBaseOperationFailure } from '../functions/resolveKnowledgeBaseOperationFailure';
import { resolveCurrentKnowledgeBaseMessage } from '../functions/resolveCurrentKnowledgeBaseMessage';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import {
  uploadRendererPluginMultipart,
  type RendererPluginUploadProgress,
} from '@plugin/renderer/pluginMultipartUpload';

let activeSession: AbortController | null = null;

/** 每次启用都有独立请求 owner；旧响应不能在重新启用后发布到新页面。 */
export function startKnowledgeRequestSession(): void {
  if (activeSession) return;
  activeSession = new AbortController();
}
export function stopKnowledgeRequestSession(): void {
  activeSession?.abort();
  activeSession = null;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  if (!activeSession) throw new Error('Knowledge plugin is not active');
  return signal ? AbortSignal.any([activeSession.signal, signal]) : activeSession.signal;
}

/** IPC 已受理的业务仍归 Backend；这里只取消页面等待与迟到呈现，不宣称远端撤单。 */
export async function invokeKnowledgeRequest(
  channel: string,
  payload: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const scope = requestSignal(signal);
  scope.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new DOMException('Knowledge request cancelled', 'AbortError'));
    scope.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([
      invokeRendererPluginIpc<unknown>('knowledge', channel, payload),
      aborted,
    ]);
    scope.throwIfAborted();
    if (!result.success) {
      const message = result.userMessage
        ? resolveKnowledgeBaseOperationFailure(
            result,
            resolveCurrentKnowledgeBaseMessage,
            'knowledgeBase.service.error.getAllIpcFailed'
          )
        : result.error;
      throw Object.assign(new Error(message), {
        failureKind: result.failureKind,
        userMessage: result.userMessage,
      });
    }
    return result.data;
  } finally {
    scope.removeEventListener('abort', onAbort);
  }
}

export async function uploadKnowledgeMultipart(
  formData: FormData,
  onProgress?: (progress: RendererPluginUploadProgress) => void,
  signal?: AbortSignal
): Promise<unknown> {
  const scope = requestSignal(signal);
  const result = await uploadRendererPluginMultipart('knowledge', 'documents/upload', {
    formData,
    signal: scope,
    onProgress,
  });
  scope.throwIfAborted();
  return result;
}

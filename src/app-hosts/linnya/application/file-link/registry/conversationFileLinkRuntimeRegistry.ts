import type { ConversationFileLinkRuntimePort } from '../definitions/conversationFileLinkRuntimePort';

let registeredRuntime: ConversationFileLinkRuntimePort | null = null;

/** Electron App owner 在 conversation lifecycle 就绪后安装唯一运行时。 */
export function registerConversationFileLinkRuntime(
  runtime: ConversationFileLinkRuntimePort,
): void {
  registeredRuntime = runtime;
}

export function getConversationFileLinkRuntime(): ConversationFileLinkRuntimePort {
  if (!registeredRuntime) {
    throw new Error('[CONVERSATION_FILE_LINK_RUNTIME_UNAVAILABLE] 文件链接运行时尚未就绪。');
  }
  return registeredRuntime;
}

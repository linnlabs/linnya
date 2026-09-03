/** 插件发起 conversation 可见单个/批量 subrun 的窄门面。 */
import type {
  ConversationSubrunRunHandle,
  RendererConversationSubrunInvocationPort,
  StartConversationSubrunsRequest,
} from '@linnya/plugin-host-contract/renderer/conversationSubrunInvocationPort';

export type {
  ConversationSubrunInvocationItem,
  ConversationSubrunRunHandle,
  ConversationSubrunWorkerContribution,
  RendererConversationSubrunInvocationPort,
  StartConversationSubrunsRequest,
} from '@linnya/plugin-host-contract/renderer/conversationSubrunInvocationPort';

let activePort: RendererConversationSubrunInvocationPort | undefined;

export function registerRendererConversationSubrunInvocationPort(
  port: RendererConversationSubrunInvocationPort,
): void {
  if (activePort) {
    throw new Error('[renderer-conversation-subrun-port] subrun invocation port 重复注册');
  }
  activePort = port;
}

export function clearRendererConversationSubrunInvocationPortForTest(): void {
  activePort = undefined;
}

function requirePort(): RendererConversationSubrunInvocationPort {
  if (!activePort) {
    throw new Error('[renderer-conversation-subrun-port] subrun invocation port 尚未注册');
  }
  return activePort;
}

export function startConversationSubruns(
  request: StartConversationSubrunsRequest,
): ConversationSubrunRunHandle {
  return requirePort().start(request);
}

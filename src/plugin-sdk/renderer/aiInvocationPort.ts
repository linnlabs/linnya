/**
 * @file aiInvocationPort.ts
 * @description 渲染端插件发起 AI 运行的窄端口。
 *
 * 中文说明：
 * - 插件只描述“要发起 AI 会话或运行”，不直接依赖 conversation store / assistantService；
 * - host 负责创建会话消息、绑定项目、调用真实 AI 服务与维护执行状态；
 * - 这样插件包可以保持独立，conversation 也不会被插件实现反向 import。
 */

import type { RendererAiInvocationPort } from '@linnya/plugin-host-contract/renderer/aiInvocationPort';

export type {
  PluginPromptKey,
  RendererAiDocumentMetadata,
  RendererAiInvocationConversation,
  RendererAiInvocationFence,
  RendererAiInvocationPort,
  RendererAiInvocationUserQuote,
  RendererAiInvocationUserQuoteItem,
  RendererAiHistoryIsolatedRunRequest,
  RendererEnsureAiConversationRequest,
  RendererSendAiMessageRequest,
} from '@linnya/plugin-host-contract/renderer/aiInvocationPort';

let activePort: RendererAiInvocationPort | undefined;

export function registerRendererAiInvocationPort(port: RendererAiInvocationPort): void {
  if (activePort) {
    if (activePort.id === port.id) return;
    throw new Error(
      `[renderer-ai-port] 重复注册 AI 调用端口：${activePort.id} / ${port.id}`
    );
  }
  activePort = port;
}

export function getRendererAiInvocationPort(): RendererAiInvocationPort | undefined {
  return activePort;
}

export function requireRendererAiInvocationPort(): RendererAiInvocationPort {
  const port = getRendererAiInvocationPort();
  if (!port) {
    throw new Error('[renderer-ai-port] AI 调用端口尚未安装');
  }
  return port;
}

/**
 * @file interactiveTool.ts
 * @description 插件工具卡提交用户互动结果的渲染端 port。
 *
 * 中文说明：
 * - 工具卡属于插件贡献，但互动结果落在 conversation 编排里；
 * - 插件只通过这个窄口提交结果，不直接 import assistantStore；
 * - 真实 host 实现由 renderer app 启动时注册，避免 SDK 反向依赖业务 store。
 */

import type {
  ConcludeInteractiveToolInteractionOptions,
  RendererInteractiveToolPort,
} from '@linnya/plugin-host-contract/renderer/interactiveTool';

export type {
  ConcludeInteractiveToolInteractionOptions,
  InteractiveToolActiveMetadata,
  InteractiveToolMetadata,
  InteractiveToolStatus,
  InteractiveToolSubmissionMetadata,
  InteractiveToolSubmissionStatus,
  RendererInteractiveToolPort,
} from '@linnya/plugin-host-contract/renderer/interactiveTool';

let interactiveToolPort: RendererInteractiveToolPort | null = null;

export function registerRendererInteractiveToolPort(port: RendererInteractiveToolPort): void {
  interactiveToolPort = port;
}

export function clearRendererInteractiveToolPortForTest(): void {
  interactiveToolPort = null;
}

function requireRendererInteractiveToolPort(): RendererInteractiveToolPort {
  if (!interactiveToolPort) {
    throw new Error('[plugin-sdk/interactiveTool] interactive tool port 尚未注册');
  }
  return interactiveToolPort;
}

export function concludeInteractiveToolInteraction(
  options: ConcludeInteractiveToolInteractionOptions,
): Promise<void> {
  return requireRendererInteractiveToolPort().concludeInteractiveToolInteraction(options);
}

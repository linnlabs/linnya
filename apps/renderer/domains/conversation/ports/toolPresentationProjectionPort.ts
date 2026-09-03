import type {
  ToolCardPresentation,
  ToolPresentationProjectorInput,
} from '@linnya/plugin-host-contract/renderer/toolUi';

export type ToolPresentationProjectionRequest = Omit<ToolPresentationProjectorInput, 'uiKey'>;

export interface ToolPresentationProjectionPort {
  /** 未注册专用 projector 的工具返回 undefined；projector 合同错误必须原样抛出。 */
  project(request: ToolPresentationProjectionRequest): ToolCardPresentation | undefined;
}

let registeredPort: ToolPresentationProjectionPort | null = null;

/** app-level 插件编排安装唯一实现；返回值仅用于测试或 host 卸载时解除本次注册。 */
export function registerToolPresentationProjectionPort(
  port: ToolPresentationProjectionPort,
): () => void {
  registeredPort = port;
  return () => {
    if (registeredPort === port) registeredPort = null;
  };
}

/**
 * live/reload admission 的共同入口。
 * port 尚未安装或工具尚未声明 projector 时没有派生字段，这是可选能力的明确状态。
 */
export function projectToolCardPresentation(
  request: ToolPresentationProjectionRequest,
): ToolCardPresentation | undefined {
  return registeredPort?.project(request);
}

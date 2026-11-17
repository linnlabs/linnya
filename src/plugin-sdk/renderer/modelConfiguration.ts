import type {
  EmbeddingModelChangeImpactPort,
  PluginAuxiliaryModelPurpose,
  PluginModelPurpose,
  RendererModelConfigurationPort,
} from '@linnya/plugin-host-contract/renderer/modelConfiguration';

export type * from '@linnya/plugin-host-contract/renderer/modelConfiguration';

let registeredPort: RendererModelConfigurationPort | null = null;

/** 仅 Host 组合根注册；artifact 的运行模块不导出该注册入口。 */
export function installRendererModelConfigurationPort(port: RendererModelConfigurationPort): void {
  registeredPort = port;
}

function port(): RendererModelConfigurationPort {
  if (!registeredPort) throw new Error('Renderer model configuration port is not installed');
  return registeredPort;
}

export function readPurposeModelId(purpose: PluginModelPurpose): string | null {
  return port().readPurposeModelId(purpose);
}
export function readAuxiliaryModelId(purpose: PluginAuxiliaryModelPurpose): string | null {
  return port().readAuxiliaryModelId(purpose);
}
export function readModelDisplayName(modelId: string): string | null {
  return port().readModelDisplayName(modelId);
}
export function subscribeModelConfigurationChanges(listener: () => void): () => void {
  return port().subscribeChanges(listener);
}
export function openModelConfiguration(): void {
  port().openModelConfiguration();
}
export function registerEmbeddingModelChangeImpactPort(impactPort: EmbeddingModelChangeImpactPort): () => void {
  return port().registerEmbeddingImpact(impactPort);
}

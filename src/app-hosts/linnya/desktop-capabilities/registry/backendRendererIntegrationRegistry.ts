import type { BackendRendererIntegrationPort } from '../definitions/backendRendererIntegrationPort';

let installedPort: BackendRendererIntegrationPort | null = null;

export function installBackendRendererIntegrationPort(
  port: BackendRendererIntegrationPort,
): void {
  if (installedPort && installedPort !== port) {
    throw new Error('Backend renderer integration 当前 App owner 已安装另一实现');
  }
  installedPort = port;
}

export function getBackendRendererIntegrationPort(): BackendRendererIntegrationPort {
  if (!installedPort) {
    throw new Error('Backend renderer integration 尚未由 App composition 安装');
  }
  return installedPort;
}

export function clearBackendRendererIntegrationPortForTesting(): void {
  installedPort = null;
}

import type { BackendHiddenWorkerRuntimePort } from '../definitions/backendHiddenWorkerRuntimePort';

let installedPort: BackendHiddenWorkerRuntimePort | null = null;

export function installBackendHiddenWorkerRuntimePort(
  port: BackendHiddenWorkerRuntimePort,
): void {
  if (installedPort && installedPort !== port) {
    throw new Error('Backend hidden worker runtime 当前 App owner 已安装另一实现');
  }
  installedPort = port;
}

export function getBackendHiddenWorkerRuntimePort(): BackendHiddenWorkerRuntimePort {
  if (!installedPort) {
    throw new Error('Backend hidden worker runtime 尚未由 App composition 安装');
  }
  return installedPort;
}

export function clearBackendHiddenWorkerRuntimePortForTesting(): void {
  installedPort = null;
}

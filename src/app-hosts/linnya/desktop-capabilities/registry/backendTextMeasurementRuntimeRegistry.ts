import type { BackendTextMeasurementRuntimeDependencies } from '../definitions/backendTextMeasurementRuntimeDependencies';

let installedDependencies: BackendTextMeasurementRuntimeDependencies | null = null;

export function installBackendTextMeasurementRuntimeDependencies(
  dependencies: BackendTextMeasurementRuntimeDependencies,
): void {
  if (installedDependencies && installedDependencies !== dependencies) {
    throw new Error('Backend text measurement runtime 当前 App owner 已安装另一实现');
  }
  installedDependencies = dependencies;
}

export function getBackendTextMeasurementRuntimeDependencies(): BackendTextMeasurementRuntimeDependencies {
  if (!installedDependencies) {
    throw new Error('Backend text measurement runtime 尚未由 App composition 安装');
  }
  return installedDependencies;
}

export function clearBackendTextMeasurementRuntimeDependenciesForTesting(): void {
  installedDependencies = null;
}

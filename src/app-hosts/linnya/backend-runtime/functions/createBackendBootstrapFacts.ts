import path from 'node:path';

import { createRuntimePathRoots } from '../../../../shared/runtime-paths';
import type { BackendBootstrapFacts } from '../definitions/backendBootstrapFacts';

export function createBackendBootstrapFacts(input: BackendBootstrapFacts): BackendBootstrapFacts {
  requireNonEmpty(input.applicationVersion, 'applicationVersion');
  requireAbsolute(input.applicationExecutablePath, 'applicationExecutablePath');
  requireNonEmpty(input.platform, 'platform');
  requireNonEmpty(input.architecture, 'architecture');
  requireAbsolute(input.resourcesPath, 'resourcesPath');
  requireAbsolute(input.mainBundleDirectory, 'mainBundleDirectory');
  requireAbsolute(input.legacyUserDataDirectory, 'legacyUserDataDirectory');
  return Object.freeze({
    ...input,
    runtimePathRoots: createRuntimePathRoots(input.runtimePathRoots),
  });
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`Backend bootstrap ${name} 不能为空`);
}

function requireAbsolute(value: string, name: string): void {
  if (!path.isAbsolute(value)) throw new Error(`Backend bootstrap ${name} 必须是绝对路径`);
}

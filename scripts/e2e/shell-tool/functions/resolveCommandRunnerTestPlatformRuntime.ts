import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  parseLocalProcessPlatformRuntime,
  type LocalProcessPlatformRuntime,
} from '../../../../src/infra/adapters/local-process-runtime/platform-runtime';
import { parseWindowsNativeRuntimeManifest } from '../../../../src/infra/adapters/local-process-runtime/windows/definitions/windowsNativeRuntimeManifest';

/**
 * E2E host 必须在创建临时目录或 fork runner 前冻结平台事实。Windows 版本直接取自
 * 已校验 manifest，避免测试脚本的硬编码版本与实际 native artifact 悄悄分叉。
 */
export function resolveCommandRunnerTestPlatformRuntime(): LocalProcessPlatformRuntime {
  if (process.platform === 'darwin') {
    return parseLocalProcessPlatformRuntime({ schema_version: 1, platform: 'darwin' });
  }
  if (process.platform !== 'win32') {
    throw new Error(`command runner E2E does not support platform ${process.platform}`);
  }

  const manifestPath = process.env.LINNYA_WINDOWS_COMMAND_RUNTIME_MANIFEST_PATH;
  if (!manifestPath) {
    throw new Error(
      'LINNYA_WINDOWS_COMMAND_RUNTIME_MANIFEST_PATH is required for Windows command runner E2E',
    );
  }
  if (!path.win32.isAbsolute(manifestPath)) {
    throw new Error('Windows command runner E2E manifest path must be absolute');
  }

  let decodedManifest: unknown;
  try {
    decodedManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error('Windows command runner E2E manifest cannot be read as JSON', {
      cause: error,
    });
  }
  const manifest = parseWindowsNativeRuntimeManifest(decodedManifest);
  return parseLocalProcessPlatformRuntime({
    schema_version: 1,
    platform: 'win32',
    manifest_path: manifestPath,
    expected_runtime_version: manifest.runtime_version,
    expected_application_version: manifest.application_version,
    trust: { kind: 'development' },
  });
}

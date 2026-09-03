import path from 'node:path';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const MAIN_FACING_ENTRY = path.resolve(
  'src/electron-main/commands/runner-runtime/createElectronCommandRunnerProcessPort.ts',
);
const UTILITY_CHILD_ENTRY = path.resolve(
  'src/infra/adapters/command-runtime/runner/child/commandRunnerUtilityProcess.ts',
);

const CHILD_ONLY_RUNTIME_SEGMENTS = [
  '/local-process-runtime/windows/functions/loadVerifiedWindowsNativeRuntimeModule.ts',
  '/local-process-runtime/windows/functions/loadWindowsOwnedPipeNativeBinding.ts',
  '/local-process-runtime/windows/functions/windowsNativeBindingContract.ts',
  '/command-runtime/windows/functions/loadWindowsOwnedPtyNativeBinding.ts',
  '/command-runtime/platform-runtime/orchestration/createCommandRunnerPlatformLauncher.ts',
] as const;

async function readBundledInputs(input: {
  readonly entry: string;
  readonly external: readonly string[];
}): Promise<readonly string[]> {
  const result = await build({
    entryPoints: [input.entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    metafile: true,
    external: [...input.external],
    logLevel: 'silent',
    tsconfig: path.resolve('tsconfig.json'),
  });
  return Object.keys(result.metafile.inputs).map(filePath => (
    filePath.split('\\').join('/')
  ));
}

describe('Electron main host-safe command runtime boundary', () => {
  it('main-facing runner composition只打包纯配置，不吸入 child-only native loader', async () => {
    const bundledInputs = await readBundledInputs({
      entry: MAIN_FACING_ENTRY,
      external: ['electron'],
    });
    expect(bundledInputs.some(filePath => (
      filePath.endsWith(
        '/local-process-runtime/platform-runtime/definitions/localProcessPlatformRuntime.ts',
      )
    ))).toBe(true);

    for (const forbiddenSegment of CHILD_ONLY_RUNTIME_SEGMENTS) {
      expect(
        bundledInputs.some(filePath => filePath.endsWith(forbiddenSegment)),
        `Electron main bundle unexpectedly included ${forbiddenSegment}`,
      ).toBe(false);
    }
  });

  it('Utility child 打包唯一 verified loader，并同时保留 pipe 与 PTY 窄 wrapper', async () => {
    const bundledInputs = await readBundledInputs({
      entry: UTILITY_CHILD_ENTRY,
      external: ['node-pty'],
    });

    for (const requiredSegment of CHILD_ONLY_RUNTIME_SEGMENTS) {
      expect(
        bundledInputs.some(filePath => filePath.endsWith(requiredSegment)),
        `Command Utility bundle is missing ${requiredSegment}`,
      ).toBe(true);
    }
  });
});

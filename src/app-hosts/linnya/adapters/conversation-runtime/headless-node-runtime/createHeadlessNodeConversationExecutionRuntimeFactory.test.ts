import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const harness = vi.hoisted(() => ({
  commandRunnerProcess: Object.freeze({ fork: vi.fn() }),
  sandboxUtilityProcessFork: Object.freeze({ fork: vi.fn() }),
  conversationFactory: Object.freeze({ create: vi.fn() }),
  createCommandRunner: vi.fn(),
  createSandboxFork: vi.fn(),
  createConversationFactory: vi.fn(),
}));

vi.mock('src/infra/adapters/command-runtime/runner/createNodeCommandRunnerProcessPort', () => ({
  createNodeCommandRunnerProcessPort: harness.createCommandRunner,
}));
vi.mock('src/infra/adapters/sandbox-runtime/local-process', () => ({
  createNodeSandboxUtilityProcessFork: harness.createSandboxFork,
}));
vi.mock('../production-runtime', () => ({
  createConversationExecutionRuntimeFactory: harness.createConversationFactory,
}));

import { createHeadlessNodeConversationExecutionRuntimeFactory } from './createHeadlessNodeConversationExecutionRuntimeFactory';

describe('Headless Node conversation runtime composition', () => {
  it.each([
    { platform: 'darwin' as const, architecture: 'arm64' as const },
    { platform: 'win32' as const, architecture: 'x64' as const },
  ])('$platform：同一随包 Node 能取得必需 OS 环境，但不能取得宿主秘密或注入选项', ({ platform, architecture }) => {
    harness.createCommandRunner.mockReturnValue(harness.commandRunnerProcess);
    harness.createSandboxFork.mockReturnValue(harness.sandboxUtilityProcessFork);
    harness.createConversationFactory.mockReturnValue(harness.conversationFactory);
    const resourcesPath = platform === 'win32'
      ? 'C:\\Program Files\\Linnya\\resources'
      : '/Applications/Linnya.app/Contents/Resources';
    const mainBundleDirectory = path.join(resourcesPath, 'app.asar', 'dist', 'main');
    const nodeExecutablePath = path.join(resourcesPath, 'headless-node-runtime', platform,
      architecture, platform === 'win32' ? 'node.exe' : 'bin/node');
    const helperEnvironment = platform === 'win32'
      ? { SystemRoot: 'C:\\Windows' }
      : { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
    const bootstrap = {
      applicationVersion: '0.0.38',
      applicationExecutablePath: platform === 'win32'
        ? 'C:\\Program Files\\Linnya\\Linnya.exe'
        : '/Applications/Linnya.app/Contents/MacOS/Linnya',
      platform,
      architecture,
      packaged: true,
      distributionIdentity: { kind: 'community' as const, packaged: true as const },
      resourcesPath,
      mainBundleDirectory,
      runtimePathRoots: {
        developmentRoot: '/workspace/linnya',
        appDataRoot: '/Users/test/Library/Application Support/Linnya/AIService',
        workspaceRoot: '/Users/test/Documents/Linnya',
        workspaceRootIsCustom: false,
      },
      exposeProviderOutboundDebugRoutes: false,
    };
    const commandHostProcessEnvironment = {
      kind: 'host_process_environment' as const,
      entries: Object.freeze({ PATH: '/user/bin', sYsTeMrOoT: 'C:\\Windows',
        API_KEY: 'not-for-internal-child', NODE_OPTIONS: '--inspect' }),
    };
    const localProcessPlatformRuntime = platform === 'darwin' ? {
      schema_version: 1 as const,
      platform: 'darwin' as const,
    } : {
      schema_version: 1 as const,
      platform: 'win32' as const,
      manifest_path: 'C:\\Program Files\\Linnya\\resources\\command-runtime.manifest.json',
      expected_runtime_version: '1.0.0',
      expected_application_version: bootstrap.applicationVersion,
      trust: { kind: 'release_unsigned' as const },
    };
    const commandPermissionSettings = {
      read: vi.fn(() => ({ status: 'missing' as const })),
      write: vi.fn(() => ({ status: 'written' as const })),
    };
    const commandApprovalHost = {
      request: vi.fn(async () => ({
        status: 'failed' as const,
        reason: 'authorization_unavailable' as const,
      })),
      settle: vi.fn(async () => undefined),
      endOwner: vi.fn(),
    };
    const commandPresentationHost = {
      bindRuntime: vi.fn(),
      reportAuditFailure: vi.fn(),
      hasAuditFailure: vi.fn(() => false),
      drainProtectedInputs: vi.fn(async () => undefined),
      drainConversation: vi.fn(async () => undefined),
      deleteConversationSettlements: vi.fn(async () => undefined),
      endAndDrain: vi.fn(async () => undefined),
    };

    const result = createHeadlessNodeConversationExecutionRuntimeFactory({
      bootstrap,
      commandHostProcessEnvironment,
      localProcessPlatformRuntime,
      headlessNodeExecutablePath: nodeExecutablePath,
      commandPermissionSettings,
      commandApprovalHost,
      commandPresentationHost,
    });

    expect(result).toBe(harness.conversationFactory);
    expect(harness.createCommandRunner).toHaveBeenLastCalledWith({
      runnerPath: path.join(mainBundleDirectory, 'commands', 'commandRunnerProcess.cjs'),
      nodeExecutablePath,
      helperEnvironment,
      platformRuntime: localProcessPlatformRuntime,
    });
    expect(harness.createSandboxFork).toHaveBeenLastCalledWith({
      nodeExecutablePath,
    });
    expect(harness.createConversationFactory).toHaveBeenLastCalledWith(expect.objectContaining({
      bootstrap,
      commandHostProcessEnvironment,
      localProcessPlatformRuntime,
      commandPermissionSettings,
      commandApprovalHost,
      commandPresentationHost,
      commandRunnerProcess: harness.commandRunnerProcess,
      sandboxUtilityProcessFork: harness.sandboxUtilityProcessFork,
      internalChildEnvironment: helperEnvironment,
    }));
  });
});

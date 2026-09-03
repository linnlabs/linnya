import { describe, expect, it, vi } from 'vitest';

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
  it('把 Command 与 Sandbox 一次性 child 都绑定到同一随包 Node', () => {
    harness.createCommandRunner.mockReturnValue(harness.commandRunnerProcess);
    harness.createSandboxFork.mockReturnValue(harness.sandboxUtilityProcessFork);
    harness.createConversationFactory.mockReturnValue(harness.conversationFactory);
    const bootstrap = {
      applicationVersion: '0.0.38',
      applicationExecutablePath: '/Applications/Linnya.app/Contents/MacOS/Linnya',
      platform: 'darwin' as const,
      architecture: 'arm64' as const,
      packaged: true,
      distributionIdentity: { kind: 'community' as const, packaged: true as const },
      resourcesPath: '/Applications/Linnya.app/Contents/Resources',
      mainBundleDirectory: '/Applications/Linnya.app/Contents/Resources/app.asar/dist/main',
      legacyUserDataDirectory: '/Users/test/Library/Application Support/Linnya',
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
      entries: Object.freeze({ PATH: '/user/bin' }),
    };
    const localProcessPlatformRuntime = {
      schema_version: 1 as const,
      platform: 'darwin' as const,
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
      headlessNodeExecutablePath: '/Applications/Linnya.app/Contents/Resources/headless-node-runtime/darwin/arm64/bin/node',
      commandPermissionSettings,
      commandApprovalHost,
      commandPresentationHost,
    });

    expect(result).toBe(harness.conversationFactory);
    expect(harness.createCommandRunner).toHaveBeenCalledWith({
      runnerPath: `${bootstrap.mainBundleDirectory}/commands/commandRunnerProcess.cjs`,
      nodeExecutablePath: '/Applications/Linnya.app/Contents/Resources/headless-node-runtime/darwin/arm64/bin/node',
      helperEnvironment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      platformRuntime: localProcessPlatformRuntime,
    });
    expect(harness.createSandboxFork).toHaveBeenCalledWith({
      nodeExecutablePath: '/Applications/Linnya.app/Contents/Resources/headless-node-runtime/darwin/arm64/bin/node',
    });
    expect(harness.createConversationFactory).toHaveBeenCalledWith(expect.objectContaining({
      bootstrap,
      commandHostProcessEnvironment,
      localProcessPlatformRuntime,
      commandPermissionSettings,
      commandApprovalHost,
      commandPresentationHost,
      commandRunnerProcess: harness.commandRunnerProcess,
      sandboxUtilityProcessFork: harness.sandboxUtilityProcessFork,
    }));
  });
});

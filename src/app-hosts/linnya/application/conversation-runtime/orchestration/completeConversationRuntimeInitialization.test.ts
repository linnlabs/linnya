import { describe, expect, it, vi } from 'vitest';

import type { CommandProductionScope } from '../../../adapters/commands/production-runtime';
import type { SandboxProductionScope } from '../definitions/conversationRuntimeLifecycle';
import { ConversationRuntimeInitializationError } from '../definitions/conversationRuntimeInitializationError';
import { completeConversationRuntimeInitialization } from './completeConversationRuntimeInitialization';

describe('Conversation runtime production composition', () => {
  it('全部 routes 准备完成后按固定顺序注册两个 owner，再提交唯一 Sandbox runner', async () => {
    const order: string[] = [];
    const commandScope = createCommandScope();
    const sandboxScope = createSandboxScope();

    const result = await completeConversationRuntimeInitialization({
      commandScope,
      sandboxScope,
      prepareRoutes: () => { order.push('prepare'); return 'prepared'; },
      registerCommandOwner: owner => {
        expect(owner).toBe(commandScope);
        order.push('command');
      },
      registerSandboxOwner: owner => {
        expect(owner).toBe(sandboxScope);
        order.push('sandbox');
      },
      installSandboxRunner: runner => {
        expect(runner).toBe(sandboxScope);
        order.push('install');
      },
    });

    expect(result).toBe('prepared');
    expect(order).toEqual(['prepare', 'command', 'sandbox', 'install']);
  });

  it.each(['prepare', 'command', 'sandbox', 'install'] as const)(
    '%s 阶段失败时仍按顺序收口两个 owner，且保留初始化与清理根因',
    async failureStage => {
      const commandCleanupFailure = new Error('command cleanup failed');
      const commandEnd = vi.fn().mockRejectedValue(commandCleanupFailure);
      const sandboxEnd = vi.fn().mockResolvedValue(undefined);
      const commandScope = createCommandScope(commandEnd);
      const sandboxScope = createSandboxScope(sandboxEnd);
      const failure = new Error(`${failureStage} failed`);

      const settlement = completeConversationRuntimeInitialization({
        commandScope,
        sandboxScope,
        prepareRoutes: () => {
          if (failureStage === 'prepare') throw failure;
          return 'prepared';
        },
        registerCommandOwner: () => {
          if (failureStage === 'command') throw failure;
        },
        registerSandboxOwner: () => {
          if (failureStage === 'sandbox') throw failure;
        },
        installSandboxRunner: () => {
          if (failureStage === 'install') throw failure;
        },
      });

      await expect(settlement).rejects.toMatchObject({
        name: ConversationRuntimeInitializationError.name,
        initializationFailure: failure,
        cleanupFailures: [commandCleanupFailure],
      });
      expect(commandEnd).toHaveBeenCalledOnce();
      expect(sandboxEnd).toHaveBeenCalledOnce();
    },
  );
});

function createCommandScope(
  endOwnerAndWait = vi.fn().mockResolvedValue(undefined),
): CommandProductionScope {
  return {
    shellToolRuntime: { executeShell: vi.fn(), executeProcess: vi.fn() },
    agentRunLifecycle: {
      endAgentRun: vi.fn().mockResolvedValue({ release: vi.fn() }),
    },
    conversationCleanupCommands: {
      beginConversationStop: vi.fn(),
      stopConversationAndWait: vi.fn().mockResolvedValue(undefined),
      forgetDeletedConversation: vi.fn(),
    },
    conversationApprovalDeletion: {
      deleteForConversation: vi.fn().mockResolvedValue(undefined),
    },
    conversationCardSettlementDeletion: {
      drainConversation: vi.fn().mockResolvedValue(undefined),
      deleteForConversation: vi.fn().mockResolvedValue(undefined),
    },
    hasExecutingCommands: () => false,
    endOwnerAndWait,
  };
}

function createSandboxScope(
  endOwnerAndWait = vi.fn().mockResolvedValue(undefined),
): SandboxProductionScope {
  return {
    execute: vi.fn(),
    endOwnerAndWait,
  };
}

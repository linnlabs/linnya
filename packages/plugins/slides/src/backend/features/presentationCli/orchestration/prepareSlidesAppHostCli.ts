import path from 'node:path';

import { formatConversationFileLocator } from '@app/schemas/file-locator';
import type {
  BackendPluginCliContribution,
  BackendPluginCliResult,
} from '@linnya/plugin-host-contract/backend';
import { checkFontFamily, listFontFamilies } from '@plugin/backend/fontResolution';
import type { Database } from 'better-sqlite3';

import { getSharedPptCoordinator } from '../../../coordinator';
import {
  SlidesCliError,
  SlidesCliExitCode,
} from '../definitions/slidesCli';
import { parseSlidesCliArgs } from '../functions/parseSlidesCliArgs';
import { createManagedSlidesRenderDirectory } from '../functions/createManagedSlidesRenderDirectory';
import { executeSlidesCliCommand } from './executeSlidesCliCommand';
import { executeSlidesCliFontCommand } from './executeSlidesCliFontCommand';

interface SlidesCliHostContext {
  readonly databaseService: {
    getDb(): Database;
  };
}

/** 当前 App bridge adapter；parser、命令类型和领域 orchestration 仍只属于 presentationCli。 */
export const slidesPluginCli: BackendPluginCliContribution = {
  prepare(input) {
    let invocation;
    try {
      invocation = parseSlidesCliArgs(input.argv, {
        resolveManagedRenderOutput(presentationId) {
          const relativeRoot = createManagedSlidesRenderDirectory(presentationId);
          return {
            root: path.join(input.conversationRoot, ...relativeRoot.split('/')),
            directoryReference: formatConversationFileLocator(relativeRoot),
          };
        },
      });
    } catch (error) {
      return {
        status: 'completed',
        result: startupErrorResult(error),
      };
    }
    if (invocation.kind === 'help') {
      return {
        status: 'completed',
        result: { exitCode: SlidesCliExitCode.SUCCESS, stdout: invocation.text, stderr: '' },
      };
    }
    const command = invocation.command;
    if (command.kind === 'fonts-check' || command.kind === 'fonts-list') {
      return {
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'none',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          async execute(context) {
            context.signal.throwIfAborted();
            return executeSlidesCliFontCommand(command, {
              checkFontFamily,
              listFontFamilies,
            }, context.signal);
          },
        },
      };
    }
    if (command.databasePath !== undefined) {
      return {
        status: 'completed',
        result: invalidArgumentsResult('--database is not available through the current App bridge'),
      };
    }

    return {
      status: 'ready',
      plan: {
        access: {
          internalDataAccess: 'required',
          conversationFiles: command.kind === 'render' ? 'write' : 'none',
          externalFiles: 'denied',
          network: 'denied',
          guiControl: 'denied',
          localIpcControl: 'denied',
        },
        async execute(context) {
          context.signal.throwIfAborted();
          const hostContext = readSlidesCliHostContext(context.hostContext);
          const coordinator = getSharedPptCoordinator(hostContext.databaseService.getDb());
          const result = await executeSlidesCliCommand(command, coordinator, context.signal);
          context.signal.throwIfAborted();
          return result;
        },
      },
    };
  },
};

function readSlidesCliHostContext(value: unknown): SlidesCliHostContext {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Slides CLI requires a host context.');
  }
  const databaseService = Reflect.get(value, 'databaseService');
  if (!isSlidesCliDatabaseService(databaseService)) {
    throw new Error('Slides CLI requires the workspace database.');
  }
  return { databaseService };
}

function isSlidesCliDatabaseService(
  value: unknown,
): value is SlidesCliHostContext['databaseService'] {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'getDb') === 'function';
}

function startupErrorResult(error: unknown): BackendPluginCliResult {
  if (error instanceof SlidesCliError) {
    return {
      exitCode: error.exitCode,
      stdout: '',
      stderr: `${error.code}: ${error.message}\n`,
    };
  }
  return invalidArgumentsResult('Invalid command arguments');
}

function invalidArgumentsResult(message: string): BackendPluginCliResult {
  return {
    exitCode: SlidesCliExitCode.INVALID_ARGUMENTS,
    stdout: '',
    stderr: `slides.cli.invalid_arguments: ${message}\n`,
  };
}

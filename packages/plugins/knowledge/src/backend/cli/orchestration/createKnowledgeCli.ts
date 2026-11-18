import type {
  BackendPluginCliContribution,
  BackendPluginCliResult,
} from '@plugin/backend/pluginCli';
import type { KnowledgeRuntime } from '../../runtime/orchestration/createKnowledgeRuntime';
import {
  KnowledgeCliPermissionError,
  KnowledgeCliUsageError,
} from '../definitions/knowledgeCliErrors';
import { parseKnowledgeCli, KNOWLEDGE_CLI_HELP } from '../functions/parseKnowledgeCli';
import { executeKnowledgeCli } from './executeKnowledgeCli';

function failure(error: unknown, cancelled: boolean): BackendPluginCliResult {
  const exitCode = cancelled
    ? 130
    : error instanceof KnowledgeCliUsageError
      ? 2
      : error instanceof KnowledgeCliPermissionError
        ? 77
        : 1;
  return {
    exitCode,
    stdout: '',
    stderr:
      JSON.stringify({
        ok: false,
        error: {
          code: cancelled
            ? 'cancelled'
            : exitCode === 2
              ? 'usage_error'
              : exitCode === 77
                ? 'permission_denied'
                : 'operation_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }) + '\n',
  };
}

/** prepare 只有解析，不获取 runtime、项目资料、模型或文件。 */
export function createKnowledgeCli(
  getRuntime: () => KnowledgeRuntime
): BackendPluginCliContribution {
  return {
    prepare({ argv }) {
      try {
        const parsed = parseKnowledgeCli(argv);
        if (parsed.kind === 'help')
          return {
            status: 'completed',
            result: { exitCode: 0, stdout: KNOWLEDGE_CLI_HELP + '\n', stderr: '' },
          };
        const command = parsed.command;
        const writes = ['documents.import', 'documents.delete', 'index.rebuild', 'unlink'].includes(
          command.action
        );
        const inference =
          command.action === 'documents.import' || command.action === 'index.rebuild';
        return {
          status: 'ready',
          plan: {
            access: {
              internalDataAccess: writes ? 'write' : 'required',
              conversationFiles: command.action === 'documents.import' ? 'read' : 'none',
              externalFiles: 'denied',
              network: 'denied',
              guiControl: 'denied',
              localIpcControl: 'denied',
              ...(inference
                ? {
                    hostInference:
                      command.action === 'index.rebuild'
                        ? (['embed'] as const)
                        : (['embed', 'text', 'ocr-profile', 'ocr'] as const),
                  }
                : {}),
            },
            async execute(context) {
              try {
                const data = await executeKnowledgeCli(getRuntime(), command, context);
                context.signal.throwIfAborted();
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({ ok: true, command: command.action, data }) + '\n',
                  stderr: '',
                };
              } catch (error) {
                return failure(error, context.signal.aborted);
              }
            },
          },
        };
      } catch (error) {
        return { status: 'completed', result: failure(error, false) };
      }
    },
  };
}

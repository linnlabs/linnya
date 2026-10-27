import { createChildRunDeliveryReader, DocumentObservationUnavailableError } from '@plugin/backend/childRunDelivery';
import { executeResearchCommand } from '../../decision-research';
import type { BackendPluginCliContribution } from '@plugin/backend/pluginCli';
import type { PluginSqliteDatabasePort } from '@plugin/backend/toolRuntime';
import { ZodError } from 'zod';
import { DECISION_CLI_HELP, parseDecisionCli, parseDecisionFilePayload } from '../functions/parseDecisionCli';
import { executeDecisionCommand } from './executeDecisionCommand';
import { DecisionFailure } from '../../decision-record';
import { readDecisionInputFile } from '../adapters/readDecisionInputFile';

interface DecisionHostContext {
  readonly databaseService: { getDb(): PluginSqliteDatabasePort };
}

function readHostContext(value: unknown): DecisionHostContext {
  if (typeof value !== 'object' || value === null) throw new Error('Decision CLI requires a project context.');
  const databaseService: unknown = Reflect.get(value, 'databaseService');
  if (!isDatabaseService(databaseService)) throw new Error('Decision CLI requires the workspace database.');
  return { databaseService };
}

function isDatabaseService(value: unknown): value is DecisionHostContext['databaseService'] {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'getDb') === 'function';
}

export const decisionPluginCli: BackendPluginCliContribution = {
  prepare({ argv, conversationRoot }) {
    let command;
    try { command = parseDecisionCli(argv); }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid arguments.';
      return { status: 'completed', result: { exitCode: 2, stdout: '', stderr: `${message}\n` } };
    }
    if (command.kind === 'help') {
      return { status: 'completed', result: { exitCode: 0, stdout: DECISION_CLI_HELP, stderr: '' } };
    }
    return {
      status: 'ready',
      plan: {
        access: {
          internalDataAccess: 'required',
          conversationFiles: command.kind === 'read' || command.kind === 'list' ? 'none' : 'write',
          externalFiles: 'denied', network: 'denied', guiControl: 'denied', localIpcControl: 'denied',
        },
        async execute(context) {
          context.signal.throwIfAborted();
          const host = readHostContext(context.hostContext);
          // 事务内没有 await；取消检查在提交前，成功提交后交付真实结果。
          try {
            if (!context.conversationId) throw new DecisionFailure('invalid_model', 'This Host does not provide the calling conversation identity. Restart with the updated Host.');
            const database = host.databaseService.getDb();
            const projectId = context.projectId;
            if (!projectId) throw new DecisionFailure('invalid_model', 'The Host did not provide a conversation project. This prototype requires a project and the updated Host bridge.');
            const resolved = command.kind === 'file'
              ? parseDecisionFilePayload(command, await readDecisionInputFile(conversationRoot, command.filePath, context.signal))
              : command;
            context.signal.throwIfAborted();
            let output: unknown;
            if (resolved.kind === 'research_prepare' || resolved.kind === 'research_read' || resolved.kind === 'research_receive' || resolved.kind === 'research_list') {
              const runId = context.agentRunId;
              if (typeof runId !== 'string' || !runId) throw new DecisionFailure('invalid_model', 'Managed research requires an active Agent run.');
              output = await executeResearchCommand(resolved, {
                db: database, projectId, conversationId: context.conversationId, runId,
                reader: await createChildRunDeliveryReader(context), signal: context.signal,
              });
            } else output = executeDecisionCommand(resolved, database, projectId);
            return { exitCode: 0, stdout: `${JSON.stringify(output)}\n`, stderr: '' };
          } catch (error: unknown) {
            if (error instanceof ZodError || error instanceof SyntaxError) {
              return { exitCode: 2, stdout: '', stderr: `decision.invalid_input: ${error.message}\n` };
            }
            if (error instanceof DocumentObservationUnavailableError) {
              return { exitCode: 3, stdout: '', stderr: `decision.not_found: ${error.message}\n` };
            }
            if (!(error instanceof DecisionFailure)) throw error;
            return { exitCode: 3, stdout: '', stderr: `decision.${error.code}: ${error.message}\n` };
          }
        },
      },
    };
  },
};

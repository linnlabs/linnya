import type { BackendPluginCliContribution, BackendPluginCliExecutionContext } from '@plugin/backend/pluginCli';
import { ZodError } from 'zod';
import { CanvasCliFailure, type CanvasCliCommand } from '../definitions/canvasCliCommand';
import { parseCanvasCli, CANVAS_CLI_HELP } from '../functions/parseCanvasCli';

export function createCanvasPluginCli(execute: (command: Exclude<CanvasCliCommand, { kind: 'help' }>, context: BackendPluginCliExecutionContext, conversationRoot: string) => Promise<unknown>, failure: (error: unknown) => unknown): BackendPluginCliContribution {
  return {
    prepare({ argv, conversationRoot }) {
      let command: CanvasCliCommand;
      try { command = parseCanvasCli(argv); }
      catch (error) { return { status: 'completed', result: { exitCode: 8, stdout: JSON.stringify({ error: formatCanvasCliInputError(error) }) + '\n', stderr: '' } }; }
      if (command.kind === 'help') return { status: 'completed', result: { exitCode: 0, stdout: JSON.stringify(CANVAS_CLI_HELP) + '\n', stderr: '' } };
      const writes = command.kind === 'apply' || command.kind === 'arrange' || command.kind === 'render';
      return { status: 'ready', plan: {
        access: { internalDataAccess: 'required', conversationFiles: writes ? 'write' : 'none', externalFiles: 'denied', network: 'denied', guiControl: 'denied', localIpcControl: 'denied' },
        async execute(context) {
          try {
            context.signal.throwIfAborted();
            const result = await execute(command, context, conversationRoot);
            return { exitCode: 0, stdout: JSON.stringify(result) + '\n', stderr: '' };
          } catch (error) { return { exitCode: 8, stdout: JSON.stringify({ error: failure(error) }) + '\n', stderr: '' }; }
        },
      } };
    },
  };
}
export function formatCanvasCliInputError(error: unknown) {
  if (error instanceof CanvasCliFailure) return { code: error.code, message: error.message, operation: error.operation, field: error.field };
  if (error instanceof ZodError) return { code: 'invalid_operations', message: '操作字段不符合合同，按 issues 修正后再提交。',
    issues: error.issues.map(issue => ({ operation: typeof issue.path[0] === 'number' ? issue.path[0] : undefined, field: issue.path.join('.'), message: issue.message })) };
  return { code: 'invalid_arguments', message: error instanceof Error ? error.message : '参数无效，请运行 linnya-canvas help。' };
}

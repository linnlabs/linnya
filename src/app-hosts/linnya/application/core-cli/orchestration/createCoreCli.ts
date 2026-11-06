import type Database from 'better-sqlite3';
import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';
import { createSqliteActionLedger } from 'src/domains/action-ledger';
import { readPersistedWorkspaceVfsNode } from 'src/features/workspace/vfs';
import { formatDocumentChanges } from '../functions/formatDocumentChanges';
import { CHANGES_USAGE, parseChangesCommand } from '../functions/parseChangesCommand';

/** 复用现有 prepare/execute 合同。prepare 只解析参数；通过父 Shell 权限校验后才读项目与数据库。 */
export function createCoreCli(db: Database.Database, maxOutputCharacters: number): BackendPluginCliContribution {
  return {
    prepare({ argv }) {
      const [command, ...args] = argv;
      const help = argv.length === 1 && command === '--help';
      const changesHelp = command === 'changes' && args.length === 1 && args[0] === '--help';
      if (help || changesHelp) {
        return { status: 'completed', result: { exitCode: 0, stdout: CHANGES_USAGE + '\n', stderr: '' } };
      }
      if (command !== 'changes') {
        return { status: 'completed', result: { exitCode: 2, stdout: '', stderr: CHANGES_USAGE + '\n' } };
      }
      let filters: ReturnType<typeof parseChangesCommand>;
      try {
        filters = parseChangesCommand(args, new Date());
      } catch (error) {
        const reason = error instanceof Error ? error.message : '参数无效';
        return { status: 'completed', result: { exitCode: 2, stdout: '', stderr: `${reason}\n${CHANGES_USAGE}\n` } };
      }
      return {
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'required', conversationFiles: 'none', externalFiles: 'denied',
            network: 'denied', guiControl: 'denied', localIpcControl: 'denied',
          },
          async execute({ projectId, signal }) {
            signal.throwIfAborted();
            if (!projectId) return { exitCode: 2, stdout: '', stderr: '当前对话没有所属项目。\n' };
            const result = createSqliteActionLedger(db).listDocumentChanges({ ...filters, projectId });
            const stdout = formatDocumentChanges(result, id => {
              const node = readPersistedWorkspaceVfsNode(db, id);
              return node ? `workspace:${node.path}` : null;
            }, maxOutputCharacters);
            return { exitCode: 0, stdout, stderr: '' };
          },
        },
      };
    },
  };
}

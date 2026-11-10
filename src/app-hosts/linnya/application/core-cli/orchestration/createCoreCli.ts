import type Database from 'better-sqlite3';
import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';
import { createSqliteActionLedger } from 'src/domains/action-ledger';
import { readPersistedWorkspaceVfsNode } from 'src/features/workspace/vfs';
import {
  readConversationTranscript,
  readProjectConversations,
  searchProjectConversations,
} from '../../project-conversations';
import { formatConversationList, formatConversationTranscript } from '../functions/formatConversations';
import { formatDocumentChanges } from '../functions/formatDocumentChanges';
import { CHANGES_USAGE, parseChangesCommand } from '../functions/parseChangesCommand';
import { CONVERSATIONS_USAGE, parseConversationsCommand, type ConversationsCommand } from '../functions/parseConversationsCommand';
import { PALETTE_USAGE } from '../functions/parsePaletteCommand';
import type { PhysicalFileReaderPort } from '../../file-read';
import { preparePaletteCli } from './preparePaletteCli';
import { prepareSemanticCli, SEMANTIC_CLI_COMMANDS, SEMANTIC_USAGE } from './prepareSemanticCli';

const CORE_USAGE = `${CHANGES_USAGE}\n${CONVERSATIONS_USAGE}\n${PALETTE_USAGE}\n${SEMANTIC_USAGE}`;
const INTERNAL_READ_ACCESS = {
  internalDataAccess: 'required', conversationFiles: 'none', externalFiles: 'denied',
  network: 'denied', guiControl: 'denied', localIpcControl: 'denied',
} as const;

/** 复用现有 prepare/execute 合同。prepare 只解析参数；通过父 Shell 权限校验后才读项目与数据库。 */
export function createCoreCli(
  db: Database.Database,
  maxOutputCharacters: number,
  fileReader: PhysicalFileReaderPort,
): BackendPluginCliContribution {
  return {
    prepare({ argv, conversationRoot }) {
      const [command, ...args] = argv;
      if (command === 'palette') return preparePaletteCli({ argv: args, conversationRoot, fileReader });
      const semantic = SEMANTIC_CLI_COMMANDS.find(name => name === command);
      if (semantic) return prepareSemanticCli({ db, command: semantic, argv: args, maxOutputCharacters });
      if (argv.length === 1 && command === '--help') {
        return { status: 'completed', result: { exitCode: 0, stdout: CORE_USAGE + '\n', stderr: '' } };
      }
      if (command === 'changes' && args.length === 1 && args[0] === '--help') {
        return { status: 'completed', result: { exitCode: 0, stdout: CHANGES_USAGE + '\n', stderr: '' } };
      }
      if (command === 'conversations') return prepareConversations(db, args, maxOutputCharacters);
      if (command !== 'changes') {
        return { status: 'completed', result: { exitCode: 2, stdout: '', stderr: CORE_USAGE + '\n' } };
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
          access: INTERNAL_READ_ACCESS,
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

/**
 * 读别的对话：只读当前项目的对话，只给可读内容（用户的话与 AI 的答复）。
 * 范围由 Host 按已授权对话的项目给出；以后跨项目的个人 Agent 另行授权，不在这里放开。
 */
function prepareConversations(
  db: Database.Database,
  args: readonly string[],
  maxOutputCharacters: number,
): ReturnType<BackendPluginCliContribution['prepare']> {
  if (args.length === 1 && args[0] === '--help') {
    return { status: 'completed', result: { exitCode: 0, stdout: CONVERSATIONS_USAGE + '\n', stderr: '' } };
  }
  let command: ConversationsCommand;
  try {
    command = parseConversationsCommand(args);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '参数无效';
    return { status: 'completed', result: { exitCode: 2, stdout: '', stderr: `${reason}\n${CONVERSATIONS_USAGE}\n` } };
  }
  return {
    status: 'ready',
    plan: {
      access: INTERNAL_READ_ACCESS,
      async execute({ projectId, signal }) {
        signal.throwIfAborted();
        if (!projectId) return { exitCode: 2, stdout: '', stderr: '当前对话没有所属项目。\n' };
        if (command.kind === 'list') {
          const rows = readProjectConversations(db, { project_id: projectId }).conversations;
          const search = command.query === null ? null : searchProjectConversations(db, { project_id: projectId, query: command.query });
          const stdout = formatConversationList({
            rows,
            matches: search === null ? null : new Map(search.matches.map(match => [match.conversation_id, match.excerpt])),
            searchTruncated: search?.truncated ?? false,
            limit: command.limit,
            maxCharacters: maxOutputCharacters,
          });
          return { exitCode: 0, stdout, stderr: '' };
        }
        const page = readConversationTranscript(db, {
          scope: { kind: 'project', projectId },
          conversationId: command.conversationId,
          ...(command.afterSeq === null ? {} : { afterSeq: command.afterSeq }),
          limit: command.limit,
        });
        if (!page) return { exitCode: 1, stdout: '', stderr: '当前项目里没有这个对话。\n' };
        return { exitCode: 0, stdout: formatConversationTranscript(page, maxOutputCharacters), stderr: '' };
      },
    },
  };
}

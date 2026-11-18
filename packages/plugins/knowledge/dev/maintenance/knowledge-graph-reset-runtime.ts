import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

import { QdrantAdapter } from '../../src/backend/infrastructure/vector-store';
import {
  getGraphEdgesCollectionName,
  getGraphNodesCollectionName,
} from '../../src/backend/graph/infrastructure/qdrantCollections';

export interface KnowledgeGraphResetArgs {
  readonly kbId: string;
  readonly withQdrant: boolean;
  readonly qdrantUrl: string;
  readonly workspaceDb: string;
  readonly workspaceRoot: string;
}

const RESETTABLE_TABLES = new Set([
  'knowledge_graph_edges',
  'knowledge_graph_nodes',
  'knowledge_graph_doc_status',
  'knowledge_graph_vector_doc_status',
  'knowledge_graph_index_status',
]);

function readArgValue(argv: readonly string[], key: string): string | undefined {
  const index = argv.indexOf(key);
  if (index < 0) return undefined;
  const value = argv[index + 1]?.trim();
  return value || undefined;
}

export function loadKnowledgeGraphMaintenanceEnvironment(): void {
  const repositoryRoot = process.cwd();
  for (const filename of ['.env.local', '.env']) {
    const candidate = path.join(repositoryRoot, filename);
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
}

/** 集合名必须在 macOS/Windows 都是一个直接子项，不能将维护目标解释为路径。 */
export function assertMaintenanceCollectionSegment(value: string): void {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    /[\/\\\u0000-\u001f<>:"|?*]/u.test(value) ||
    /[. ]$/u.test(value)
  ) {
    throw new Error('维护目标必须是合法的单段名称，不能包含路径或系统保留字符');
  }
}

export function parseKnowledgeGraphResetArgs(argv: readonly string[]): KnowledgeGraphResetArgs {
  const kbId = readArgValue(argv, '--kbId');
  if (!kbId) {
    throw new Error('缺少参数：--kbId <knowledge_base_id>');
  }
  assertMaintenanceCollectionSegment(kbId);
  const workspaceDb = path.resolve(
    readArgValue(argv, '--workspaceDb') ??
      path.join(process.cwd(), '_dev_data/workspace/workspace.sqlite')
  );
  const workspaceRoot = path.resolve(
    readArgValue(argv, '--workspaceRoot') ?? path.dirname(path.dirname(workspaceDb))
  );
  return {
    kbId,
    workspaceDb,
    workspaceRoot,
    withQdrant: argv.includes('--withQdrant'),
    qdrantUrl: readArgValue(argv, '--qdrantUrl') ?? 'http://127.0.0.1:6333',
  };
}

async function deleteLocalCollectionDirectory(
  workspaceRoot: string,
  collectionName: string
): Promise<void> {
  assertMaintenanceCollectionSegment(collectionName);
  const directory = path.join(
    workspaceRoot,
    'KnowledgeBase',
    'qdrant',
    'storage',
    'collections',
    collectionName
  );
  await fsp.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}

/** SDK 保留 fetch 的 cause；只有连接拒绝能证明目标端口没有运行中的服务。 */
function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AggregateError' && 'errors' in error && Array.isArray(error.errors)) {
    // localhost 的双栈连接会聚合多个地址，必须全部明确拒绝，不能把其中的超时当离线。
    return (
      error.errors.length > 0 && error.errors.every((cause: unknown) => isConnectionRefused(cause))
    );
  }
  if ('code' in error && error.code === 'ECONNREFUSED') return true;
  return 'cause' in error && isConnectionRefused(error.cause);
}

export async function deleteKnowledgeGraphVectorCollections(
  args: KnowledgeGraphResetArgs
): Promise<void> {
  assertMaintenanceCollectionSegment(args.kbId);
  if (!args.withQdrant) return;
  const endpoint = new URL(args.qdrantUrl);
  const isLocalEndpoint = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);

  const collectionNames = [
    getGraphNodesCollectionName(args.kbId),
    getGraphEdgesCollectionName(args.kbId),
  ];
  const adapter = new QdrantAdapter({
    url: args.qdrantUrl,
    timeout: 30_000,
    checkCompatibility: false,
  });

  try {
    for (const collectionName of collectionNames) {
      if (await adapter.collectionExists(collectionName)) {
        await adapter.deleteCollection(collectionName);
      }
    }
  } catch (error) {
    // HTTP 错误、超时或未知原因不证明服务离线，不能绕过仍运行的 Qdrant 直接删文件。
    if (!isLocalEndpoint || !isConnectionRefused(error)) throw error;
    console.warn(
      `[KG-RESET] 本机 Qdrant 连接被拒绝，改用离线目录清理：${error instanceof Error ? error.message : String(error)}`
    );
    for (const collectionName of collectionNames) {
      await deleteLocalCollectionDirectory(args.workspaceRoot, collectionName);
    }
  }
}

export function clearKnowledgeGraphTablesInDatabase(params: {
  readonly database: Database.Database;
  readonly kbId: string;
  readonly tableNames: readonly string[];
}): void {
  assertMaintenanceCollectionSegment(params.kbId);
  for (const tableName of params.tableNames) {
    if (!RESETTABLE_TABLES.has(tableName)) {
      throw new Error(`不允许清理未知知识图谱表：${tableName}`);
    }
  }

  const clear = params.database.transaction(() => {
    for (const tableName of params.tableNames) {
      params.database.prepare(`DELETE FROM "${tableName}" WHERE kb_id = ?`).run(params.kbId);
    }
  });
  clear();
}

export function clearKnowledgeGraphDatabaseTables(params: {
  readonly workspaceDb: string;
  readonly kbId: string;
  readonly tableNames: readonly string[];
}): void {
  assertMaintenanceCollectionSegment(params.kbId);
  const database = new Database(params.workspaceDb, { fileMustExist: true });
  try {
    clearKnowledgeGraphTablesInDatabase({ database, ...params });
  } finally {
    database.close();
  }
}

export function printKnowledgeGraphMaintenanceHelp(command: string): boolean {
  if (!process.argv.slice(2).some(arg => ['--help', '-h', 'help'].includes(arg))) return false;
  console.log(`用法: pnpm run ${command} -- --kbId <id> [--workspaceDb <path>] [--workspaceRoot <path>] [--withQdrant] [--qdrantUrl <url>]
仅处理指定知识库的图谱派生数据；运行前退出同数据目录的 App。不会删除原文、PDF 或其他知识库。
--withQdrant 同时删除图谱向量；仅本机连接被拒绝时清理所选 Workspace 内同名离线目录；HTTP 错误、超时和远端失败直接报错。`);
  return true;
}

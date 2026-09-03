import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

import { QdrantAdapter } from 'src/infra/adapters/vector-store/qdrant';
import {
  getGraphEdgesCollectionName,
  getGraphNodesCollectionName,
} from 'src/features/knowledge-base/graph/infrastructure/qdrantCollections';
import { pathManager } from 'src/shared/utils/pathManager';

export interface KnowledgeGraphResetArgs {
  readonly kbId: string;
  readonly withQdrant: boolean;
  readonly qdrantUrl: string;
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

export function parseKnowledgeGraphResetArgs(
  argv: readonly string[],
): KnowledgeGraphResetArgs {
  const kbId = readArgValue(argv, '--kbId');
  if (!kbId) {
    throw new Error('缺少参数：--kbId <knowledge_base_id>');
  }
  return {
    kbId,
    withQdrant: argv.includes('--withQdrant'),
    qdrantUrl: readArgValue(argv, '--qdrantUrl') ?? 'http://127.0.0.1:6333',
  };
}

async function deleteLocalCollectionDirectory(collectionName: string): Promise<void> {
  const directory = path.join(
    pathManager.getKbDataPath(),
    'qdrant',
    'storage',
    'collections',
    collectionName,
  );
  await fsp.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}

export async function deleteKnowledgeGraphVectorCollections(
  args: KnowledgeGraphResetArgs,
): Promise<void> {
  if (!args.withQdrant) return;

  const collectionNames = [
    getGraphNodesCollectionName(args.kbId),
    getGraphEdgesCollectionName(args.kbId),
  ];
  const adapter = QdrantAdapter.getInstance({
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
    // Qdrant 服务通常随 App 一起退出；显式 --withQdrant 时允许离线清理同一受管目录。
    console.warn(
      `[KG-RESET] Qdrant API 不可用，改用离线目录清理：${error instanceof Error ? error.message : String(error)}`,
    );
    for (const collectionName of collectionNames) {
      await deleteLocalCollectionDirectory(collectionName);
    }
  }
}

export function clearKnowledgeGraphTablesInDatabase(params: {
  readonly database: Database.Database;
  readonly kbId: string;
  readonly tableNames: readonly string[];
}): void {
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
  readonly kbId: string;
  readonly tableNames: readonly string[];
}): void {
  const databasePath = path.join(pathManager.getWorkspaceDataPath(), 'workspace.sqlite');
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    clearKnowledgeGraphTablesInDatabase({ database, ...params });
  } finally {
    database.close();
  }
}

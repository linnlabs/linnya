/**
 * @file scripts/e2e/knowledge-base/knowledge-search.e2e.ts
 *
 * @description
 * 知识库搜索 CLI（命令行调试工具）：
 * - 不需要通过“对话 Agent”来调用工具；
 * - 直接在终端执行，打印知识库浅搜索的 StructuredToolResult；没有真实 Conversation，不持久化历史证据。
 *
 * 重要说明（边界与预期）：
 * - 本脚本 **不会** 启动 `deep_search` 子 Agent（即不会触发对话式 LLM 规划/调用链路）；
 * - 但“RAG/软图谱”本身依赖 embedding / rerank 等模型能力：
 *   - 如果你的 KB 配置了 embedding / rerank 模型，则会按现有链路发起对应 API 调用；
 *   - 这是为了保证输出与 `KnowledgeSearchTool` 在产品中的行为一致（根因一致性）。
 *
 * 推荐运行方式（在项目根目录）：
 * - 通过 Electron Node 环境（与应用运行时更一致）：
 *   pnpm run test:knowledge-search -- <command> [args...]
 *
 * 命令：
 * - list-projects
 * - list-project-kbs <projectId>
 * - search --projectId <id> --query <text> [--docId <doc_id>] [--topK <n>] [--graph <off|light|full>] [--qdrantUrl <url>]
 *
 * 示例：
 * - 列出项目：
 *   pnpm run test:knowledge-search -- list-projects
 *
 * - 查看某项目关联的知识库：
 *   pnpm run test:knowledge-search -- list-project-kbs <projectId>
 *
 * - 在命令行执行 knowledge_search（浅搜）并指定图谱档位：
 *   pnpm run test:knowledge-search -- search --projectId <projectId> --query "苹果 供应链 风险" --graph full
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { isObjectLike } from '@linnya/foundation';
import {
  getGraphNodesCollectionName as getGraphNodesCollectionNameCli,
  getGraphEdgesCollectionName as getGraphEdgesCollectionNameCli,
} from '../../src/backend/graph/infrastructure/qdrantCollections';

async function initializeDiagnosticModelServices(workspaceRoot: string) {
  const { installRuntimePathRoots } = await import('src/shared/runtime-paths');
  const { createSourceDistributionIdentity, installDistributionIdentity } = await import(
    'src/shared/distribution-identity'
  );
  const { initializeWorkerModelServices } = await import(
    'src/app-hosts/linnya/backend-runtime/workerModelServices'
  );
  const developmentRoot = process.cwd();
  dotenv.config({ path: path.join(developmentRoot, '.env.local') });
  dotenv.config({ path: path.join(developmentRoot, '.env') });
  const { sourceDefaultModelsPath } = await import('src/domains/model-catalog');
  process.env.MODEL_REGISTRY_DEFAULTS_PATH ??= sourceDefaultModelsPath(developmentRoot);
  // 源码诊断入口与 Desktop/CLI 共用 profile，凭据不跟随被诊断的 Workspace。
  const runtimePathRoots = installRuntimePathRoots({
    developmentRoot,
    appDataRoot: path.join(developmentRoot, '_dev_data'),
    profileRoot: path.join(developmentRoot, '_dev_electron'),
    workspaceRoot,
    workspaceRootIsCustom: workspaceRoot !== path.join(developmentRoot, '_dev_data'),
  });
  await initializeWorkerModelServices({
    runtimePathRoots,
    distributionIdentity: installDistributionIdentity(createSourceDistributionIdentity()),
  });
  const { createEmbeddingPort, createRerankingPort } = await import(
    'src/app-hosts/linnya/adapters/inference'
  );
  return { embedding: createEmbeddingPort(), reranking: createRerankingPort() };
}

import { QdrantAdapter } from '../../src/backend/infrastructure/vector-store';
import type { QdrantCollectionInfo } from '../../src/backend/infrastructure/vector-store';

// ✅ 重要：本脚本包含 “纯 Qdrant 调试命令”（qdrant-info/peek/count），必须避免模块级副作用噪音。
// 因此：与 KB/AI/解析器相关的依赖一律改为 **动态 import**（仅在 search/list-* 等命令中才加载）。
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { GraphMode } from '../../src/backend/graph/application/graphBudget';
import { readConfiguredTargetSegmentCount } from '../../src/backend/infrastructure/qdrant-repository/segmentPolicy';

type CliDeps = { database: Database.Database; workspaceRoot: string };
const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  system_role: z.string().nullable(),
  created_at: z.number(),
});
type CliProjectRow = z.infer<typeof projectRowSchema>;
const idRowSchema = z.object({ id: z.string() });

const DEFAULT_PROJECT_SYSTEM_ROLE = 'default';
const DEFAULT_DEV_WORKSPACE_DB_PATH = path.resolve(
  process.cwd(),
  '_dev_data',
  'workspace',
  'workspace.sqlite'
);

function readNonEmptyString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function readInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

function parseGraphMode(v: unknown): GraphMode | null {
  const s = readNonEmptyString(v);
  if (!s) return null;
  if (s === 'off' || s === 'light' || s === 'full') return s;
  return null;
}

function pickFlagValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  const next = args[idx + 1];
  return readNonEmptyString(next);
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function formatProjectRow(row: CliProjectRow): string {
  return [
    `- id: ${row.id}`,
    `  name: ${row.name}`,
    `  description: ${row.description ?? '无'}`,
    `  system_role: ${row.system_role ?? '普通项目'}`,
    `  created_at: ${new Date(row.created_at).toLocaleString()}`,
    '',
  ].join('\n');
}

function resolveDefaultProjectIdFromDb(db: Database.Database): string | null {
  // 中文说明：默认项目的身份来自数据库系统角色，不能再依赖用户可修改的中文名称。
  const row = db
    .prepare('SELECT id FROM projects WHERE deleted_at IS NULL AND system_role = ? LIMIT 1')
    .get(DEFAULT_PROJECT_SYSTEM_ROLE);
  return row ? idRowSchema.parse(row).id : null;
}

function resolveSingleProjectIdFromDb(db: Database.Database): string | null {
  const rows = db
    .prepare('SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 2')
    .all();
  if (rows.length === 1) return idRowSchema.parse(rows[0]).id;
  return null;
}

function showHelp(): void {
  console.log(`
KnowledgeBase Search CLI

用法：
  pnpm run test:knowledge-search -- <command> [args...]

命令：
  list-projects
      默认只列出系统默认项目（system_role='${DEFAULT_PROJECT_SYSTEM_ROLE}'）。
      - 加 --all：列出 Workspace 里的所有项目（projects 表）。
      - 加 --workspaceDb <path>：指定要读取的 workspace.sqlite（默认：${DEFAULT_DEV_WORKSPACE_DB_PATH}）。
      - 可选：--workspaceRoot <path>：显式指定 workspace 根目录（用于 SoT/KB 目录推导）；不传则从 workspaceDb 推导。

  list-project-kbs <projectId>
      列出该项目关联的知识库 kb_id 列表（project_knowledge_base_links 表）。

  qdrant-info [--kbId <kb_id>] [--qdrantUrl <url>]
      打印 Qdrant 集合信息（用于调试 full 的 discovery/multi-hop 是否有向量点）：
      - chunk collection: <kb_id>（默认 kb_id='default'）
      - graph collections: kg_nodes_<kb_id> / kg_edges_<kb_id>
      - 输出 points_count / indexed_vectors_count 等关键指标

  qdrant-count --collection <name> [--qdrantUrl <url>] [--blockType <type>] [--metadataKey <k>] [--metadataValue <v>]
      统计某个集合在指定 filter 下的点数量（用于定位“points_count>0 但 search=0”的根因）：
      - --blockType: 对 payload.block_type 做 match（单值）
      - --metadataKey/--metadataValue: 对 payload.metadata.<k> 做 match（单值）

  qdrant-peek --collection <name> [--qdrantUrl <url>] [--limit <n>]
      抽样打印集合前 N 个点的 payload 关键字段（用于核对实际写入 schema 是否与代码一致；避免打印 document/statement 全文）。

  qdrant-search --collection <name> --text <query> [--qdrantUrl <url>] [--topK <n>] [--blockType <type>] [--scoreThreshold <0-1>] [--embeddingModelId <id>]
      用“真实 query 向量”对指定集合执行语义搜索，并打印 topK 分数（用于校准 full 的阈值是否过严）：
      - 默认 embeddingModelId='text-embedding-3-small'（需与图谱向量化使用的模型一致）
      - 不传 --scoreThreshold 表示不设阈值（总会返回 topK）

  search [--projectId <id>] --query <text> [--docId <doc_id>] [--topK <n>] [--graph <off|light|full>] [--qdrantUrl <url>]
      执行正式浅搜索与格式化，打印 StructuredToolResult；开发诊断不创建对话、不写历史 Evidence。
      - 追加 --noAi：强制不触发任何 embedding/rerank/LLM 调用，只走关键词(BM25)检索 + 图谱附加（不会跑 discovery）。
      - 如果不传 --projectId：会自动选择系统默认项目（system_role='${DEFAULT_PROJECT_SYSTEM_ROLE}'）。
      - 加 --workspaceDb <path>：指定要读取的 workspace.sqlite（默认：${DEFAULT_DEV_WORKSPACE_DB_PATH}）。
      - 可选：--workspaceRoot <path>：显式指定 workspace 根目录（用于 SoT/KB 目录推导）；不传则从 workspaceDb 推导。
      - 输出模式（对齐“最终发给 AI 的 tool content”）：
        - 默认：--print ai（只输出 observation 原文，不带任何前后缀）
        - --print json：只输出工具返回的 JSON（StructuredToolResult）
        - --print both：先输出 JSON，再输出 observation 原文

示例：
  pnpm run test:knowledge-search -- list-projects
  pnpm run test:knowledge-search -- list-projects --all
  pnpm run test:knowledge-search -- list-project-kbs <projectId>
  pnpm run test:knowledge-search -- qdrant-info --kbId default
  pnpm run test:knowledge-search -- qdrant-peek --collection kg_nodes_default --limit 3
  pnpm run test:knowledge-search -- qdrant-count --collection kg_nodes_default --blockType kg_node
  pnpm run test:knowledge-search -- qdrant-search --collection kg_nodes_default --text "碳中和 供应链 风险" --topK 5
  pnpm run test:knowledge-search -- search --projectId <projectId> --query "苹果 供应链" --graph full
  pnpm run test:knowledge-search -- search --projectId <projectId> --query "苹果 供应链" --graph full --noAi
  pnpm run test:knowledge-search -- search --query "苹果 供应链" --graph full
  pnpm run test:knowledge-search -- search --query "苹果 供应链" --graph full --workspaceDb ${DEFAULT_DEV_WORKSPACE_DB_PATH}
`);
}

type PrintMode = 'ai' | 'json' | 'both';

function parsePrintMode(v: unknown): PrintMode | null {
  const s = readNonEmptyString(v);
  if (!s) return null;
  if (s === 'ai' || s === 'json' || s === 'both') return s;
  return null;
}

function readObservationFromToolOutput(output: string): string | null {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!isObjectLike(parsed)) return null;
    const obs = parsed.observation;
    return typeof obs === 'string' ? obs : null;
  } catch {
    return null;
  }
}

function parsePositiveInt(v: unknown): number | null {
  const s = readNonEmptyString(v);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseFloat01(v: unknown): number | null {
  const s = readNonEmptyString(v);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

function resolveQdrantUrlFromArgv(argv: string[]): string {
  return (
    readNonEmptyString(pickFlagValue(argv, '--qdrantUrl')) ??
    readNonEmptyString(process.env.QDRANT_URL) ??
    'http://localhost:6333'
  );
}

function initCliDeps(params: {
  workspaceDbPath: string | null;
  workspaceRoot: string | null;
}): CliDeps {
  const workspaceDbPath = path.resolve(params.workspaceDbPath ?? DEFAULT_DEV_WORKSPACE_DB_PATH);
  const workspaceRoot = path.resolve(
    params.workspaceRoot ?? path.dirname(path.dirname(workspaceDbPath))
  );
  // 诊断不迁移、不建空库，也不写 Conversation/Evidence；传错路径直接失败。
  return {
    database: new Database(workspaceDbPath, { readonly: true, fileMustExist: true }),
    workspaceRoot,
  };
}

async function handleQdrantInfoStandalone(argv: string[]): Promise<void> {
  const kbId = readNonEmptyString(pickFlagValue(argv, '--kbId')) ?? 'default';
  const qdrantUrl = resolveQdrantUrlFromArgv(argv);
  const qdrantAdapter = QdrantAdapter.getInstance({ url: qdrantUrl });
  const collections = [
    { label: 'chunks', name: kbId },
    { label: 'kg_nodes', name: getGraphNodesCollectionNameCli(kbId) },
    { label: 'kg_edges', name: getGraphEdgesCollectionNameCli(kbId) },
  ];

  console.log(`[qdrant-info] kbId=${kbId}, qdrantUrl=${qdrantUrl}`);
  for (const c of collections) {
    try {
      const info: QdrantCollectionInfo = await qdrantAdapter.getCollection(c.name);
      console.log(
        [
          `- ${c.label}: ${c.name}`,
          `  points_count=${info.points_count}`,
          `  indexed_vectors_count=${info.indexed_vectors_count}`,
          `  vectors_count=${info.vectors_count}`,
          `  segments_count=${info.segments_count}`,
          `  target_segment_number=${readConfiguredTargetSegmentCount(info.config ?? {})}`,
        ].join('\n')
      );
    } catch (e) {
      console.log(
        `- ${c.label}: ${c.name}\n  ❌ getCollectionInfo failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}

type QdrantCountFilter = { must: Array<{ key: string; match: { value: string } }> };

function buildSimpleCountFilter(args: {
  blockType?: string;
  metadataKey?: string;
  metadataValue?: string;
}): QdrantCountFilter | undefined {
  const must: Array<{ key: string; match: { value: string } }> = [];

  if (typeof args.blockType === 'string' && args.blockType.trim().length > 0) {
    must.push({ key: 'block_type', match: { value: args.blockType.trim() } });
  }

  const metaKey = typeof args.metadataKey === 'string' ? args.metadataKey.trim() : '';
  const metaValue = typeof args.metadataValue === 'string' ? args.metadataValue.trim() : '';
  if (metaKey.length > 0 && metaValue.length > 0) {
    must.push({ key: `metadata.${metaKey}`, match: { value: metaValue } });
  }

  if (must.length === 0) return undefined;
  return { must };
}

async function handleQdrantCountStandalone(argv: string[]): Promise<void> {
  const qdrantUrl = resolveQdrantUrlFromArgv(argv);
  const collectionName = readNonEmptyString(pickFlagValue(argv, '--collection'));
  if (!collectionName) {
    throw new Error('❌ qdrant-count 需要 --collection <name>');
  }

  const blockType = readNonEmptyString(pickFlagValue(argv, '--blockType')) ?? undefined;
  const metadataKey = readNonEmptyString(pickFlagValue(argv, '--metadataKey')) ?? undefined;
  const metadataValue = readNonEmptyString(pickFlagValue(argv, '--metadataValue')) ?? undefined;
  const filter = buildSimpleCountFilter({ blockType, metadataKey, metadataValue });

  const qdrantAdapter = QdrantAdapter.getInstance({ url: qdrantUrl });
  const count = await qdrantAdapter.countPoints(collectionName, filter ? { filter } : undefined);

  console.log(
    [
      `[qdrant-count] collection=${collectionName}, qdrantUrl=${qdrantUrl}`,
      `  filter=${filter ? JSON.stringify(filter) : 'undefined'}`,
      `  count=${count}`,
    ].join('\n')
  );
}

function pickSafePreviewFields(payload: Record<string, unknown>): Record<string, unknown> {
  const preview: Record<string, unknown> = {};

  const readString = (k: string): string | undefined => {
    const v = payload[k];
    return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
  };
  preview['doc_id'] = readString('doc_id');
  preview['block_id'] = readString('block_id');
  preview['doc_title'] = readString('doc_title');
  preview['block_type'] = readString('block_type');

  const metadata = payload['metadata'];
  if (isObjectLike(metadata)) {
    const m = metadata;
    const kind = typeof m['kind'] === 'string' ? m['kind'] : undefined;
    const nodeId = typeof m['node_id'] === 'string' ? m['node_id'] : undefined;
    const edgeId = typeof m['edge_id'] === 'string' ? m['edge_id'] : undefined;
    preview['metadata'] = {
      kind,
      node_id: nodeId,
      edge_id: edgeId,
      // 只打印 keys，避免 statement/document 过长污染输出
      _keys: Object.keys(m).slice(0, 30),
    };
  } else {
    preview['metadata'] = undefined;
  }

  preview['_payload_keys'] = Object.keys(payload).slice(0, 50);
  return preview;
}

async function handleQdrantPeekStandalone(argv: string[]): Promise<void> {
  const qdrantUrl = resolveQdrantUrlFromArgv(argv);
  const collectionName = readNonEmptyString(pickFlagValue(argv, '--collection'));
  if (!collectionName) {
    throw new Error('❌ qdrant-peek 需要 --collection <name>');
  }

  const limit = parsePositiveInt(pickFlagValue(argv, '--limit')) ?? 3;
  const qdrantAdapter = QdrantAdapter.getInstance({ url: qdrantUrl });
  const points = await qdrantAdapter.scrollPointsWithVector(collectionName, limit);

  const summarizeVector = (v: unknown): Record<string, unknown> => {
    // 兼容：vector 可能是 number[] 或命名向量对象
    if (Array.isArray(v)) {
      const len = v.every(x => typeof x === 'number') ? v.length : undefined;
      return { kind: 'dense_array', length: len };
    }
    if (isObjectLike(v)) {
      const r = v;
      const keys = Object.keys(r);
      const defaultVec = r['default'];
      const bm25Vec = r['bm25'];
      const defaultLen =
        Array.isArray(defaultVec) && defaultVec.every(x => typeof x === 'number')
          ? defaultVec.length
          : undefined;
      const bm25Shape = isObjectLike(bm25Vec) ? Object.keys(bm25Vec) : undefined;
      return { kind: 'named_vectors', keys, default_length: defaultLen, bm25_keys: bm25Shape };
    }
    return { kind: 'unknown', type: typeof v };
  };

  console.log(`[qdrant-peek] collection=${collectionName}, qdrantUrl=${qdrantUrl}, limit=${limit}`);
  for (const p of points) {
    console.log(
      `- id=${p.id}\n  preview=${JSON.stringify(pickSafePreviewFields(p.payload))}\n  vector=${JSON.stringify(
        summarizeVector(p.vector)
      )}`
    );
  }
}

async function handleQdrantSearchStandalone(argv: string[]): Promise<void> {
  const qdrantUrl = resolveQdrantUrlFromArgv(argv);
  const collectionName = readNonEmptyString(pickFlagValue(argv, '--collection'));
  const text = readNonEmptyString(pickFlagValue(argv, '--text'));
  if (!collectionName) {
    throw new Error('❌ qdrant-search 需要 --collection <name>');
  }
  if (!text) {
    throw new Error('❌ qdrant-search 需要 --text <query>');
  }

  // 注意：这是“诊断命令”，需要真实 embedding，因此会触发模型初始化与网络调用（由用户在本地执行）。
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  const { sourceDefaultModelsPath } = await import('src/domains/model-catalog');
  process.env.MODEL_REGISTRY_DEFAULTS_PATH ??= sourceDefaultModelsPath(process.cwd());
  const { createEmbeddingPort } = await import('src/app-hosts/linnya/adapters/inference');

  await initializeDiagnosticModelServices(path.resolve(process.cwd(), '_dev_data'));
  const embedding = createEmbeddingPort();

  const embeddingModelId =
    readNonEmptyString(pickFlagValue(argv, '--embeddingModelId')) ?? 'text-embedding-3-small';
  const topK = parsePositiveInt(pickFlagValue(argv, '--topK')) ?? 10;
  const scoreThreshold = parseFloat01(pickFlagValue(argv, '--scoreThreshold')) ?? undefined;
  const blockType = readNonEmptyString(pickFlagValue(argv, '--blockType')) ?? undefined;

  const denseVectorsRaw = (
    await embedding.embed({
      modelId: embeddingModelId,
      values: [text],
    })
  ).vectors;
  const v0 = denseVectorsRaw[0];
  if (!Array.isArray(v0)) {
    throw new Error('qdrant-search: embedding 返回格式非法（不是 number[]）');
  }
  const queryVector: number[] = [];
  for (const n of v0) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new Error('qdrant-search: embedding 返回格式非法（元素不是有限数字）');
    }
    queryVector.push(n);
  }

  const qdrantAdapter = QdrantAdapter.getInstance({ url: qdrantUrl });
  const filter = buildSimpleCountFilter({ blockType });

  const results = await qdrantAdapter.searchPoints(collectionName, {
    vector: queryVector,
    vectorName: 'default',
    limit: topK,
    ...(filter ? { filter } : {}),
    ...(scoreThreshold !== undefined ? { scoreThreshold } : {}),
  });

  const pickMeta = (payload: Record<string, unknown>, k: string): string | undefined => {
    const m = payload['metadata'];
    if (!isObjectLike(m)) return undefined;
    const r = m;
    const v = r[k];
    return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
  };

  console.log(
    [
      `[qdrant-search] collection=${collectionName}, qdrantUrl=${qdrantUrl}`,
      `  embeddingModelId=${embeddingModelId}, vector_dim=${queryVector.length}`,
      `  topK=${topK}, scoreThreshold=${scoreThreshold ?? 'undefined'}`,
      `  filter=${filter ? JSON.stringify(filter) : 'undefined'}`,
      `  query=${JSON.stringify(text)}`,
      `  hits=${results.length}`,
    ].join('\n')
  );

  for (const r of results) {
    const payload = r.payload ?? {};
    const docId = typeof payload['doc_id'] === 'string' ? payload['doc_id'] : '';
    const blockId = typeof payload['block_id'] === 'string' ? payload['block_id'] : '';
    const bt = typeof payload['block_type'] === 'string' ? payload['block_type'] : '';
    const kind = pickMeta(payload, 'kind') ?? '';
    const nodeId = pickMeta(payload, 'node_id') ?? '';
    const edgeId = pickMeta(payload, 'edge_id') ?? '';
    console.log(
      `- score=${r.score.toFixed(4)} id=${r.id} block_type=${bt} meta.kind=${kind} meta.node_id=${nodeId} meta.edge_id=${edgeId} doc_id=${docId} block_id=${blockId}`
    );
  }
}

async function handleListProjects(deps: CliDeps, argv: string[]): Promise<void> {
  const db = deps.database;
  const showAll = hasFlag(argv, '--all');
  const sql = showAll
    ? 'SELECT id, name, description, system_role, created_at FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC'
    : 'SELECT id, name, description, system_role, created_at FROM projects WHERE deleted_at IS NULL AND system_role = ? ORDER BY created_at DESC';
  const rows = showAll
    ? projectRowSchema.array().parse(db.prepare(sql).all())
    : projectRowSchema.array().parse(db.prepare(sql).all(DEFAULT_PROJECT_SYSTEM_ROLE));

  if (rows.length === 0) {
    console.log(
      showAll
        ? '当前没有任何项目。'
        : `未找到系统默认项目（system_role='${DEFAULT_PROJECT_SYSTEM_ROLE}'）。`
    );
    return;
  }

  console.log(`共 ${rows.length} 个项目：\n`);
  for (const r of rows) {
    console.log(formatProjectRow(r));
  }
}

async function handleListProjectKbs(
  deps: CliDeps,
  projectIdRaw: string | undefined
): Promise<void> {
  const projectId = readNonEmptyString(projectIdRaw);
  if (!projectId) {
    throw new Error('❌ list-project-kbs 需要提供 <projectId>');
  }

  const db = deps.database;
  const rows = db
    .prepare(
      'SELECT kb_id, created_at FROM project_knowledge_base_links WHERE project_id = ? ORDER BY created_at ASC'
    )
    .all(projectId);
  const links = z.object({ kb_id: z.string(), created_at: z.number() }).array().parse(rows);

  if (rows.length === 0) {
    console.log(`项目 ${projectId} 当前未关联任何知识库（工具层将回退到 default）。`);
    return;
  }

  console.log(`项目 ${projectId} 关联的知识库：\n`);
  for (const r of links) {
    console.log(`- kb_id: ${r.kb_id} (linked_at: ${new Date(r.created_at).toLocaleString()})`);
  }
}

async function handleSearch(deps: CliDeps, argv: string[]): Promise<void> {
  const projectIdFromFlag = pickFlagValue(argv, '--projectId');
  const query = pickFlagValue(argv, '--query');
  const docId = pickFlagValue(argv, '--docId');
  const topK = readInt(pickFlagValue(argv, '--topK')) ?? 5;
  const graphMode = parseGraphMode(pickFlagValue(argv, '--graph')) ?? 'light';
  const noAi = hasFlag(argv, '--noAi') || hasFlag(argv, '--no-ai');
  const printMode = parsePrintMode(pickFlagValue(argv, '--print')) ?? 'ai';

  if (!query) {
    throw new Error('❌ search 必须提供 --query <text>');
  }
  if (topK <= 0) {
    throw new Error('❌ --topK 必须是正整数');
  }

  // projectId 默认策略：优先 CLI 显式传入；否则自动选择系统默认项目；若仍找不到且只有一个项目，则用唯一项目兜底。
  const db = deps.database;
  const defaultProjectId = resolveDefaultProjectIdFromDb(db);
  const singleProjectId = resolveSingleProjectIdFromDb(db);
  const projectId = projectIdFromFlag ?? defaultProjectId ?? singleProjectId;
  if (!projectId) {
    throw new Error(
      '无法确定 projectId：请传 --projectId <id>，或先用 list-projects --all 查看项目列表。'
    );
  }

  const { runDiagnosticSearch } = await import('./runDiagnosticSearch');
  const output = JSON.stringify(
    await runDiagnosticSearch({
      database: deps.database,
      workspaceRoot: deps.workspaceRoot,
      projectId,
      query,
      docId: docId ?? undefined,
      topK,
      graphMode,
      noAi,
      qdrantUrl: resolveQdrantUrlFromArgv(argv),
      initializeModels: () => initializeDiagnosticModelServices(deps.workspaceRoot),
    })
  );
  const observation = readObservationFromToolOutput(output);

  if (printMode === 'json') {
    console.log(output);
    return;
  }

  if (printMode === 'both') {
    console.log(output);
  }

  // ✅ 对齐“最终发给 AI 的 tool content”：只打印 observation 原文，不添加任何包裹字符
  console.log(observation ?? output);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return 0;
  }

  /**
   * qdrant-info 是“纯 Qdrant”调试命令：
   * - 不需要初始化 workspace.sqlite / inference ports / Model Catalog；
   * - 这样可以避免无关模块初始化带来的噪音（例如 pdfjs）。
   */
  if (command === 'qdrant-info') {
    await handleQdrantInfoStandalone(argv);
    return 0;
  }
  if (command === 'qdrant-count') {
    await handleQdrantCountStandalone(argv);
    return 0;
  }
  if (command === 'qdrant-peek') {
    await handleQdrantPeekStandalone(argv);
    return 0;
  }
  if (command === 'qdrant-search') {
    await handleQdrantSearchStandalone(argv);
    return 0;
  }

  const workspaceDbPath = pickFlagValue(argv, '--workspaceDb');
  const workspaceRoot = pickFlagValue(argv, '--workspaceRoot');
  const deps = initCliDeps({ workspaceDbPath, workspaceRoot });

  try {
    if (command === 'list-projects') {
      await handleListProjects(deps, argv);
      return 0;
    }
    if (command === 'list-project-kbs') {
      await handleListProjectKbs(deps, argv[1]);
      return 0;
    }
    if (command === 'search') {
      await handleSearch(deps, argv);
      return 0;
    }

    console.error(`未知命令: ${command}`);
    showHelp();
    return 1;
  } finally {
    deps.database.close();
  }
}

main()
  .then(code => {
    // CLI 工具必须确定性退出，否则 Electron-run-as-node 会因为残留句柄导致需要手动 Ctrl+C
    process.exit(code);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });

/**
 * @file scripts/e2e/knowledge-base/knowledge-search.e2e.ts
 *
 * @description
 * 知识库搜索 CLI（命令行调试工具）：
 * - 不需要通过“对话 Agent”来调用工具；
 * - 直接在终端执行，打印 **knowledge_search 返回给 AI 的 JSON 输出**（StructuredToolResult）。
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

import { QdrantAdapter } from 'src/infra/adapters/vector-store/qdrant';
import type { QdrantCollectionInfo, QdrantConfig } from 'src/infra/adapters/vector-store/qdrant';

// ✅ 重要：本脚本包含 “纯 Qdrant 调试命令”（qdrant-info/peek/count），必须避免模块级副作用噪音。
// 因此：与 KB/AI/解析器相关的依赖一律改为 **动态 import**（仅在 search/list-* 等命令中才加载）。
import type { DatabaseService as DatabaseServiceType } from 'src/electron-main/services/database';
import type { QdrantRepositoryImpl } from 'src/features/knowledge-base/infrastructure/QdrantRepositoryImpl';
import type { BetterSqliteMetadataRepository } from 'src/features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository';
import type { FileSotRepository } from 'src/features/knowledge-base/infrastructure/sotRepository';
import type { BetterSqliteKnowledgeGraphRepository } from 'src/features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository';
import type { DefaultSearchService } from 'src/features/knowledge-base/application/searchService';
import type { KnowledgeBaseCoordinator } from 'src/features/knowledge-base/application/KnowledgeBaseCoordinator';
import type {
  KnowledgeBaseSearchRequest,
  DocumentSearchRequest,
  SearchResponse,
  TaskStatusView,
  KnowledgeBaseWithDocumentCount,
  KnowledgeBaseGraphSearchOptions,
} from 'src/features/knowledge-base/application/knowledgeBaseService';
import type { Document } from 'src/features/knowledge-base/domain/document';
import type { KnowledgeBase } from 'src/features/knowledge-base/domain/knowledgeBase';
import type {
  SearchFilterOptions,
  RetrievedPoint,
} from 'src/features/knowledge-base/infrastructure/qdrantRepository';
import type { ToolContext } from 'src/tools/types';
import type { GraphMode } from 'src/features/knowledge-base/graph/application/graphBudget';
import type { KnowledgeGraphRepository } from 'src/features/knowledge-base/graph/infrastructure/knowledgeGraphRepository';
import type { AgentKnowledgeSearchOutput } from 'src/features/knowledge-base/application/search/agentSearchOutput';
import type {
  GraphAugmentation,
  GraphEvidenceRef,
  GraphSearchService,
} from 'src/features/knowledge-base/graph/application/graphSearchService';
import { readConfiguredTargetSegmentCount } from 'src/features/knowledge-base/infrastructure/qdrant-repository/segmentPolicy';
import { attachCitationSequence } from 'src/domains/citation';

function getGraphNodesCollectionNameCli(kbId: string): string {
  return `kg_nodes_${kbId}`;
}
function getGraphEdgesCollectionNameCli(kbId: string): string {
  return `kg_edges_${kbId}`;
}

type KBService = NonNullable<ToolContext['knowledgeBaseService']>;

type CliToolContextBase = {
  databaseService: DatabaseServiceType;
  knowledgeBaseService: KBService;
  childRunDepth: number;
};

type CliDeps = {
  databaseService: DatabaseServiceType;
  toolContextBase: CliToolContextBase;
  qdrantRepository: QdrantRepositoryImpl;
};

const DEFAULT_PROJECT_SYSTEM_ROLE = 'default';
const DEFAULT_DEV_WORKSPACE_DB_PATH = path.resolve(
  process.cwd(),
  '_dev_data',
  'workspace',
  'workspace.sqlite'
);

type CliProjectRow = {
  id: string;
  name: string;
  description: string | null;
  system_role: string | null;
  created_at: number;
};

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

function resolveDefaultProjectIdFromDb(
  db: ReturnType<DatabaseServiceType['getDb']>
): string | null {
  // 中文说明：默认项目的身份来自数据库系统角色，不能再依赖用户可修改的中文名称。
  const row = db
    .prepare('SELECT id FROM projects WHERE deleted_at IS NULL AND system_role = ? LIMIT 1')
    .get(DEFAULT_PROJECT_SYSTEM_ROLE) as { id: string } | undefined;
  return row?.id ?? null;
}

function resolveSingleProjectIdFromDb(db: ReturnType<DatabaseServiceType['getDb']>): string | null {
  const rows = db
    .prepare('SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 2')
    .all() as Array<{ id: string }>;
  if (rows.length === 1) return rows[0].id;
  return null;
}

function showHelp(): void {
  // eslint-disable-next-line no-console
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
      执行 knowledge_search 的浅搜索，并打印“返回给 AI 的 JSON（StructuredToolResult）”。
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
    if (!parsed || typeof parsed !== 'object') return null;
    const obs = (parsed as { observation?: unknown }).observation;
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

/**
 * CLI 专用：无 AI 模式（不触发任何 embedding / rerank / LLM）。
 *
 * 说明：
 * - 仅用于命令行“快速回归/验收”，不影响线上链路；
 * - 召回改为纯关键词（BM25 稀疏向量，完全本地计算），并保持 `searchRawResults` 的 payload 合同；
 * - 图谱增强仍可工作（light/full 只影响附加字段与预算裁剪），但 **不会跑 discovery**（discovery/multi-hop 都需要 queryVector）。
 */
class CliNoAiKnowledgeBaseService implements KBService {
  private readonly base: KBService;
  private readonly qdrant: QdrantRepositoryImpl;
  private readonly metadata: BetterSqliteMetadataRepository;
  private readonly sot: FileSotRepository;
  private readonly kgRepo: KnowledgeGraphRepository;

  constructor(deps: {
    base: KBService;
    qdrant: QdrantRepositoryImpl;
    metadata: BetterSqliteMetadataRepository;
    sot: FileSotRepository;
    kgRepo: KnowledgeGraphRepository;
  }) {
    this.base = deps.base;
    this.qdrant = deps.qdrant;
    this.metadata = deps.metadata;
    this.sot = deps.sot;
    this.kgRepo = deps.kgRepo;
  }

  // ====== 通用：非搜索能力全部委托给 base（保持行为一致） ======
  createKnowledgeBase(name: string, description?: string): Promise<KnowledgeBase> {
    return this.base.createKnowledgeBase(name, description);
  }
  getAllKnowledgeBases(): Promise<KnowledgeBaseWithDocumentCount[]> {
    return this.base.getAllKnowledgeBases();
  }
  getOrCreateDefaultKnowledgeBase(): Promise<KnowledgeBase> {
    return this.base.getOrCreateDefaultKnowledgeBase();
  }
  addDocument(
    kbId: string,
    filePath: string,
    fileName: string,
    fileSize: number,
    embeddingModelId: string,
    pdfOcrModelId?: string,
    imageVisionModelId?: string,
    rerankModelId?: string,
    forceVisionMode?: boolean
  ): Promise<{ taskId: string; document: Document }> {
    return this.base.addDocument(
      kbId,
      filePath,
      fileName,
      fileSize,
      embeddingModelId,
      pdfOcrModelId,
      imageVisionModelId,
      rerankModelId,
      forceVisionMode
    );
  }
  getDocumentsInKnowledgeBase(kbId: string): Promise<Document[]> {
    return this.base.getDocumentsInKnowledgeBase(kbId);
  }
  getDocumentById(docId: string): Promise<Document | undefined> {
    return this.base.getDocumentById(docId);
  }
  getTasksStatus(docIds: string[]): Promise<Record<string, TaskStatusView>> {
    return this.base.getTasksStatus(docIds);
  }
  cancelTask(taskId: string): Promise<void> {
    return this.base.cancelTask(taskId);
  }
  pauseTask(taskId: string): Promise<void> {
    return this.base.pauseTask(taskId);
  }
  resumeTask(taskId: string): Promise<void> {
    return this.base.resumeTask(taskId);
  }
  deleteDocument(kbId: string, docId: string): Promise<void> {
    return this.base.deleteDocument(kbId, docId);
  }
  continueFailedPdfPages(kbId: string, docId: string) {
    return this.base.continueFailedPdfPages(kbId, docId);
  }
  deleteKnowledgeBase(kbId: string): Promise<void> {
    return this.base.deleteKnowledgeBase(kbId);
  }
  updateKnowledgeBaseSettings(
    kbId: string,
    payload: {
      name?: string;
      description?: string | null;
      embeddingModelId?: string | null;
      rerankModelId?: string | null;
      pdfOcrModelId?: string | null;
      imageVisionModelId?: string | null;
      visionModelId?: string | null;
      tags?: string[];
      enableGraphIndexing?: boolean;
    }
  ): Promise<KnowledgeBase> {
    return this.base.updateKnowledgeBaseSettings(kbId, payload);
  }
  getRawSoTDocument(docId: string) {
    return this.base.getRawSoTDocument(docId);
  }
  getGraphAugmentationsForEvidenceBlocks(
    refs: GraphEvidenceRef[],
    options?: {
      enableOneHopExpansion?: boolean;
      maxEdgesPerEntity?: number;
    }
  ): Promise<ReadonlyMap<string, GraphAugmentation>> {
    return this.base.getGraphAugmentationsForEvidenceBlocks(refs, options);
  }
  getSoTDocumentForAgent(docId: string, startPage?: number, endPage?: number): Promise<string> {
    return this.base.getSoTDocumentForAgent(docId, startPage, endPage);
  }
  getSoTTableForAgent(docId: string, blockId: string, maxRows?: number): Promise<string> {
    return this.base.getSoTTableForAgent(docId, blockId, maxRows);
  }
  getDocumentContent(params: {
    docId: string;
    startPage?: number;
    endPage?: number;
  }): Promise<string> {
    return this.base.getDocumentContent(params);
  }

  // ====== 无 AI 搜索实现 ======
  private buildFilterForDocIds(docIds?: string[]): SearchFilterOptions | undefined {
    if (!docIds || docIds.length === 0) return undefined;
    return { docIds };
  }

  private async filterExistingDocs(points: RetrievedPoint[]): Promise<RetrievedPoint[]> {
    const docIds = Array.from(
      new Set(
        points
          .map(p => p.payload?.doc_id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      )
    );
    if (docIds.length === 0) return [];

    const checks = await Promise.all(
      docIds.map(async docId => {
        const doc = await this.metadata.getDocumentById(docId);
        return { docId, exists: !!doc };
      })
    );
    const existing = new Set(checks.filter(x => x.exists).map(x => x.docId));
    return points.filter(p => existing.has(p.payload.doc_id));
  }

  private toRawSearchPayload(points: RetrievedPoint[]): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const p of points) {
      const payload: Record<string, unknown> = { ...p.payload };
      // CLI 回归与生产 `searchRawResults` 共用同一投影字段。
      payload['rrf_score'] = p.score;
      payload['rerank_score'] = undefined;
      payload['match_type'] = p.match_type ?? 'keyword';
      payload['final_match_type'] = p.match_type ?? 'keyword';
      out.push(payload);
    }
    return out;
  }

  async search(_request: KnowledgeBaseSearchRequest): Promise<SearchResponse> {
    // CLI 当前不使用该接口；为避免误用，这里明确提示。
    throw new Error(
      'CliNoAiKnowledgeBaseService.search 未启用，请使用 searchForAgent/searchRawResults。'
    );
  }
  async searchKnowledgeBase(_request: KnowledgeBaseSearchRequest): Promise<SearchResponse> {
    throw new Error(
      'CliNoAiKnowledgeBaseService.searchKnowledgeBase 未启用，请使用 searchForAgent/searchRawResults。'
    );
  }
  async searchInDocument(_request: DocumentSearchRequest): Promise<SearchResponse> {
    throw new Error(
      'CliNoAiKnowledgeBaseService.searchInDocument 未启用，请使用 searchForAgent/searchRawResults。'
    );
  }

  async searchRawResults(
    kbId: string,
    query: string,
    topK: number,
    docIds?: string[],
    _useReranking: boolean = false
  ): Promise<Array<Record<string, unknown>>> {
    const filter = this.buildFilterForDocIds(docIds);
    const points = await this.qdrant.keywordSearch(kbId, query, Math.max(1, topK) * 2, filter);
    const filtered = await this.filterExistingDocs(points);
    const finalPoints = filtered.slice(0, Math.max(1, topK));
    return this.toRawSearchPayload(finalPoints);
  }

  async searchForAgent(
    kbId: string,
    query: string,
    topK: number = 5,
    docId?: string,
    citationOffset: number = 0,
    graph?: KnowledgeBaseGraphSearchOptions
  ): Promise<AgentKnowledgeSearchOutput> {
    const docIds = docId ? [docId] : undefined;
    const results = await this.searchRawResults(kbId, query, topK, docIds, false);

    if (!graph || graph.mode === 'off') {
      const { formatSearchResultsForLLM } = await import(
        'src/features/knowledge-base/utils/searchUtils'
      );
      const { projectAgentKnowledgeSearchHits } = await import(
        'src/features/knowledge-base/application/search/agentSearchOutput'
      );
      return {
        observation: await formatSearchResultsForLLM(
          results,
          this.sot,
          docId,
          query,
          citationOffset
        ),
        hits: projectAgentKnowledgeSearchHits(results),
      };
    }

    const refs: Array<{ kbId: string; docId: string; blockId: string }> = [];
    for (const r of results) {
      const docIdRaw = r['doc_id'];
      const blockIdRaw = r['block_id'];
      const d = typeof docIdRaw === 'string' ? docIdRaw : '';
      const b = typeof blockIdRaw === 'string' ? blockIdRaw : '';
      if (!d.trim() || !b.trim()) continue;
      refs.push({ kbId, docId: d, blockId: b });
    }

    const { GraphSearchService } = await import(
      'src/features/knowledge-base/graph/application/graphSearchService'
    );
    const graphSearchService = new GraphSearchService(this.kgRepo);
    const augmentations = await graphSearchService.getAugmentationsForEvidenceBlocks(refs);

    const { formatSearchResultsForLLM } = await import(
      'src/features/knowledge-base/utils/searchUtils'
    );
    const { projectAgentKnowledgeSearchHits } = await import(
      'src/features/knowledge-base/application/search/agentSearchOutput'
    );
    return {
      observation: await formatSearchResultsForLLM(
        results,
        this.sot,
        docId,
        query,
        citationOffset,
        {
          kbId,
          graphAugmentations: augmentations,
          graphMode: graph.mode,
          graphBudget: graph.budget,
        }
      ),
      hits: projectAgentKnowledgeSearchHits(results),
    };
  }

  async searchForAgentAcrossKnowledgeBases(request: {
    kbIds: string[];
    query: string;
    topK?: number;
    graph?: KnowledgeBaseGraphSearchOptions;
  }): Promise<AgentKnowledgeSearchOutput> {
    const kbIds = Array.from(
      new Set(
        request.kbIds.map(x => (typeof x === 'string' ? x.trim() : '')).filter(x => x.length > 0)
      )
    );
    const query = request.query;
    const topK = typeof request.topK === 'number' && request.topK > 0 ? request.topK : 5;
    const graph = request.graph;

    if (kbIds.length === 0) {
      throw new Error('CLI search scope has no knowledge bases');
    }

    const merged: Array<Record<string, unknown>> = [];
    for (const kbId of kbIds) {
      const items = await this.searchRawResults(kbId, query, topK, undefined, false);
      for (const item of items) merged.push({ ...item, _kb_id: kbId });
    }

    if (merged.length === 0) {
      const { formatSearchResultsForLLM } = await import(
        'src/features/knowledge-base/utils/searchUtils'
      );
      return {
        observation: await formatSearchResultsForLLM([], this.sot, undefined, query),
        hits: [],
      };
    }

    const pickScore = (item: Record<string, unknown>): number => {
      const rrf = item['rrf_score'];
      return typeof rrf === 'number' && Number.isFinite(rrf) ? rrf : 0;
    };
    merged.sort((a, b) => pickScore(b) - pickScore(a));
    const finalResults = merged.slice(0, topK);

    if (!graph || graph.mode === 'off') {
      const { formatSearchResultsForLLM } = await import(
        'src/features/knowledge-base/utils/searchUtils'
      );
      const { projectAgentKnowledgeSearchHits } = await import(
        'src/features/knowledge-base/application/search/agentSearchOutput'
      );
      return {
        observation: await formatSearchResultsForLLM(finalResults, this.sot, undefined, query),
        hits: projectAgentKnowledgeSearchHits(finalResults),
      };
    }

    const refs: Array<{ kbId: string; docId: string; blockId: string }> = [];
    for (const r of finalResults) {
      const kbIdFromItem = typeof r['_kb_id'] === 'string' ? r['_kb_id'] : '';
      const docIdRaw = r['doc_id'];
      const blockIdRaw = r['block_id'];
      const d = typeof docIdRaw === 'string' ? docIdRaw : '';
      const b = typeof blockIdRaw === 'string' ? blockIdRaw : '';
      if (!kbIdFromItem.trim() || !d.trim() || !b.trim()) continue;
      refs.push({ kbId: kbIdFromItem, docId: d, blockId: b });
    }

    const { GraphSearchService } = await import(
      'src/features/knowledge-base/graph/application/graphSearchService'
    );
    const graphSearchService = new GraphSearchService(this.kgRepo);
    const augmentations = await graphSearchService.getAugmentationsForEvidenceBlocks(refs);

    const { formatSearchResultsForLLM } = await import(
      'src/features/knowledge-base/utils/searchUtils'
    );
    const { projectAgentKnowledgeSearchHits } = await import(
      'src/features/knowledge-base/application/search/agentSearchOutput'
    );
    return {
      observation: await formatSearchResultsForLLM(finalResults, this.sot, undefined, query, 0, {
        graphAugmentations: augmentations,
        graphMode: graph.mode,
        graphBudget: graph.budget,
      }),
      hits: projectAgentKnowledgeSearchHits(finalResults),
    };
  }
}

/**
 * 初始化 CLI 所需依赖（尽量只初始化“搜索所需”的最小集合）。
 *
 * 设计取舍：
 * - 不复用 ServiceInitializer：避免启动队列/维护任务等额外副作用；
 * - 但依赖组合与生产一致：DatabaseService + QdrantAdapter + Embedding/Reranking 窄端口 + KB/Graph 仓储 + SearchService。
 */
async function initCliDeps(params: {
  qdrantUrl?: string | null;
  workspaceDbPath?: string | null;
  workspaceRoot?: string | null;
}): Promise<CliDeps> {
  const { DatabaseService } = await import('src/electron-main/services/database');
  const { pathManager } = await import('src/shared/utils/pathManager');
  const { modelCatalog, sourceDefaultModelsPath } = await import('src/domains/model-catalog');
  const { createEmbeddingPort, createRerankingPort } = await import(
    'src/app-hosts/linnya/adapters/inference'
  );
  const { QdrantRepositoryImpl } = await import(
    'src/features/knowledge-base/infrastructure/QdrantRepositoryImpl'
  );
  const { BetterSqliteMetadataRepository } = await import(
    'src/features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository'
  );
  const { FileSotRepository } = await import(
    'src/features/knowledge-base/infrastructure/sotRepository'
  );
  const { FileOriginalDocumentRepository } = await import(
    'src/features/knowledge-base/infrastructure/fileOriginalDocumentRepository'
  );
  const { BetterSqliteKnowledgeGraphRepository } = await import(
    'src/features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository'
  );
  const { DefaultSearchService } = await import(
    'src/features/knowledge-base/application/searchService'
  );
  const { KnowledgeBaseCoordinator } = await import(
    'src/features/knowledge-base/application/KnowledgeBaseCoordinator'
  );

  // 与应用启动一致：本机密钥只从根目录环境文件加载。
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  process.env.MODEL_REGISTRY_DEFAULTS_PATH ??= sourceDefaultModelsPath(process.cwd());

  // 1) DB（workspace.sqlite）
  // 说明：ESM 模块导入会导致 pathManager 的 workspaceRoot 可能在其他模块初始化阶段就被缓存，
  // 因此 CLI 不依赖 LINNYA_DEV_MODE 推导路径，而是直接显式指定 workspace.sqlite 路径（确定性）。
  const workspaceDbPath =
    readNonEmptyString(params.workspaceDbPath) ?? DEFAULT_DEV_WORKSPACE_DB_PATH;
  const workspaceRootFromDbPath = path.dirname(path.dirname(workspaceDbPath));
  const workspaceRoot = readNonEmptyString(params.workspaceRoot) ?? workspaceRootFromDbPath;

  // ✅ 关键对齐：把 SoT/KB 等文件系统根目录与 workspace.sqlite 绑定到同一个 Workspace Root
  // 否则 formatSearchResultsForLLM 无法读取相邻块，Prev/Next 会缺失（你刚刚看到的就是这个问题）。
  pathManager.setWorkspaceRoot(workspaceRoot);

  // eslint-disable-next-line no-console
  console.log('[kb-search-cli] 使用 workspace.sqlite', {
    workspaceDbPath,
    workspaceRoot,
    workspaceDataPath: pathManager.getWorkspaceDataPath(),
  });

  const databaseService = new DatabaseService(workspaceDbPath);
  databaseService.initialize();

  // 2) 模型注册表（embedding/rerank 会用到）
  await modelCatalog.initialize();

  // 3) Qdrant
  const qdrantUrl =
    readNonEmptyString(params.qdrantUrl) ??
    readNonEmptyString(process.env.QDRANT_URL) ??
    'http://localhost:6333';
  const qdrantConfig: QdrantConfig = { url: qdrantUrl };
  const qdrantAdapter = QdrantAdapter.getInstance(qdrantConfig);
  const qdrantRepository = new QdrantRepositoryImpl(qdrantAdapter);

  // 4) 窄推理端口（用于 embedding/reranking）
  const embedding = createEmbeddingPort();
  const reranking = createRerankingPort();

  // 5) SoT（文件系统）
  const sotPath = await pathManager.getSourceOfTruthPath();
  const sotRepository = new FileSotRepository(sotPath);
  const originalDocumentRepository = new FileOriginalDocumentRepository(
    pathManager.getKnowledgeBaseOriginalsPath()
  );

  // 6) 元数据 / 图谱仓储（SQLite）
  const metadataRepository = new BetterSqliteMetadataRepository(databaseService);
  const knowledgeGraphRepository = new BetterSqliteKnowledgeGraphRepository(databaseService);

  // 7) SearchService + KnowledgeBaseService（默认：生产一致，包含 embedding/rerank）
  const searchService = new DefaultSearchService({
    qdrantRepository,
    metadataRepository,
    sotRepository,
    embedding,
    reranking,
    knowledgeGraphRepository,
  });

  const baseKnowledgeBaseService = new KnowledgeBaseCoordinator({
    metadataRepository,
    sotRepository,
    originalDocumentRepository,
    qdrantRepository,
    searchService,
    knowledgeGraphRepository,
  });

  const toolContextBase: CliToolContextBase = {
    databaseService,
    // 默认使用“生产一致”的 KB Service；是否启用 no-ai，会在 handleSearch 里根据参数覆写 context.knowledgeBaseService
    knowledgeBaseService: baseKnowledgeBaseService,
    childRunDepth: 0,
  };

  return { databaseService, toolContextBase, qdrantRepository };
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

  // eslint-disable-next-line no-console
  console.log(`[qdrant-info] kbId=${kbId}, qdrantUrl=${qdrantUrl}`);
  for (const c of collections) {
    try {
      const info: QdrantCollectionInfo = await qdrantAdapter.getCollection(c.name);
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.error('❌ qdrant-count 需要 --collection <name>');
    return;
  }

  const blockType = readNonEmptyString(pickFlagValue(argv, '--blockType')) ?? undefined;
  const metadataKey = readNonEmptyString(pickFlagValue(argv, '--metadataKey')) ?? undefined;
  const metadataValue = readNonEmptyString(pickFlagValue(argv, '--metadataValue')) ?? undefined;
  const filter = buildSimpleCountFilter({ blockType, metadataKey, metadataValue });

  const qdrantAdapter = QdrantAdapter.getInstance({ url: qdrantUrl });
  const count = await qdrantAdapter.countPoints(collectionName, filter ? { filter } : undefined);

  // eslint-disable-next-line no-console
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
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const m = metadata as Record<string, unknown>;
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
    // eslint-disable-next-line no-console
    console.error('❌ qdrant-peek 需要 --collection <name>');
    return;
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
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const r = v as Record<string, unknown>;
      const keys = Object.keys(r);
      const defaultVec = r['default'];
      const bm25Vec = r['bm25'];
      const defaultLen =
        Array.isArray(defaultVec) && defaultVec.every(x => typeof x === 'number')
          ? defaultVec.length
          : undefined;
      const bm25Shape =
        bm25Vec && typeof bm25Vec === 'object' && !Array.isArray(bm25Vec)
          ? Object.keys(bm25Vec as Record<string, unknown>)
          : undefined;
      return { kind: 'named_vectors', keys, default_length: defaultLen, bm25_keys: bm25Shape };
    }
    return { kind: 'unknown', type: typeof v };
  };

  // eslint-disable-next-line no-console
  console.log(`[qdrant-peek] collection=${collectionName}, qdrantUrl=${qdrantUrl}, limit=${limit}`);
  for (const p of points) {
    // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.error('❌ qdrant-search 需要 --collection <name>');
    return;
  }
  if (!text) {
    // eslint-disable-next-line no-console
    console.error('❌ qdrant-search 需要 --text <query>');
    return;
  }

  // 注意：这是“诊断命令”，需要真实 embedding，因此会触发模型初始化与网络调用（由用户在本地执行）。
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  const { modelCatalog, sourceDefaultModelsPath } = await import('src/domains/model-catalog');
  process.env.MODEL_REGISTRY_DEFAULTS_PATH ??= sourceDefaultModelsPath(process.cwd());
  const { createEmbeddingPort } = await import('src/app-hosts/linnya/adapters/inference');

  await modelCatalog.initialize();
  const embedding = createEmbeddingPort();

  const embeddingModelId =
    readNonEmptyString(pickFlagValue(argv, '--embeddingModelId')) ?? 'text-embedding-3-small';
  const topK = parsePositiveInt(pickFlagValue(argv, '--topK')) ?? 10;
  const scoreThreshold = parseFloat01(pickFlagValue(argv, '--scoreThreshold')) ?? undefined;
  const blockType = readNonEmptyString(pickFlagValue(argv, '--blockType')) ?? undefined;

  const denseVectorsRaw = (await embedding.embed({
    modelId: embeddingModelId,
    values: [text],
  })).vectors;
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
    if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
    const r = m as Record<string, unknown>;
    const v = r[k];
    return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
  };

  // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.log(
      `- score=${r.score.toFixed(4)} id=${r.id} block_type=${bt} meta.kind=${kind} meta.node_id=${nodeId} meta.edge_id=${edgeId} doc_id=${docId} block_id=${blockId}`
    );
  }
}

async function handleListProjects(deps: CliDeps, argv: string[]): Promise<void> {
  const db = deps.databaseService.getDb();
  const showAll = hasFlag(argv, '--all');
  const sql = showAll
    ? 'SELECT id, name, description, system_role, created_at FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC'
    : 'SELECT id, name, description, system_role, created_at FROM projects WHERE deleted_at IS NULL AND system_role = ? ORDER BY created_at DESC';
  const rows = showAll
    ? (db.prepare(sql).all() as CliProjectRow[])
    : (db.prepare(sql).all(DEFAULT_PROJECT_SYSTEM_ROLE) as CliProjectRow[]);

  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      showAll
        ? '当前没有任何项目。'
        : `未找到系统默认项目（system_role='${DEFAULT_PROJECT_SYSTEM_ROLE}'）。`
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`共 ${rows.length} 个项目：\n`);
  for (const r of rows) {
    // eslint-disable-next-line no-console
    console.log(formatProjectRow(r));
  }
}

async function handleListProjectKbs(
  deps: CliDeps,
  projectIdRaw: string | undefined
): Promise<void> {
  const projectId = readNonEmptyString(projectIdRaw);
  if (!projectId) {
    // eslint-disable-next-line no-console
    console.error('❌ list-project-kbs 需要提供 <projectId>');
    return;
  }

  const db = deps.databaseService.getDb();
  const rows = db
    .prepare(
      'SELECT kb_id, created_at FROM project_knowledge_base_links WHERE project_id = ? ORDER BY created_at ASC'
    )
    .all(projectId) as Array<{ kb_id: string; created_at: number }>;

  if (rows.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`项目 ${projectId} 当前未关联任何知识库（工具层将回退到 default）。`);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`项目 ${projectId} 关联的知识库：\n`);
  for (const r of rows) {
    // eslint-disable-next-line no-console
    console.log(`- kb_id: ${r.kb_id} (linked_at: ${new Date(r.created_at).toLocaleString()})`);
  }
}

async function handleSearch(deps: CliDeps, argv: string[]): Promise<void> {
  const { KnowledgeSearchTool } = await import(
    'src/tools/knowledgebase/search/KnowledgeSearchTool'
  );
  const projectIdFromFlag = pickFlagValue(argv, '--projectId');
  const query = pickFlagValue(argv, '--query');
  const docId = pickFlagValue(argv, '--docId');
  const topK = readInt(pickFlagValue(argv, '--topK')) ?? 5;
  const graphMode = parseGraphMode(pickFlagValue(argv, '--graph')) ?? 'light';
  const noAi = hasFlag(argv, '--noAi') || hasFlag(argv, '--no-ai');
  const printMode = parsePrintMode(pickFlagValue(argv, '--print')) ?? 'ai';

  if (!query) {
    // eslint-disable-next-line no-console
    console.error('❌ search 必须提供 --query <text>');
    return;
  }
  if (topK <= 0) {
    // eslint-disable-next-line no-console
    console.error('❌ --topK 必须是正整数');
    return;
  }

  // projectId 默认策略：优先 CLI 显式传入；否则自动选择系统默认项目；若仍找不到且只有一个项目，则用唯一项目兜底。
  const db = deps.databaseService.getDb();
  const defaultProjectId = resolveDefaultProjectIdFromDb(db);
  const singleProjectId = resolveSingleProjectIdFromDb(db);
  const projectId = projectIdFromFlag ?? defaultProjectId ?? singleProjectId;
  if (!projectId) {
    // eslint-disable-next-line no-console
    console.error(
      `❌ 无法确定 projectId：请传 --projectId <id>，或先用 list-projects --all 查看项目列表。`
    );
    return;
  }

  // 只跑浅搜：deep_search 始终 false（避免启动子 Agent）。
  const toolArgs: Record<string, unknown> = {
    query,
    top_k: topK,
    ...(docId ? { doc_id: docId } : {}),
    deep_search: false,
  };

  // 如果启用 --noAi：替换 context.knowledgeBaseService 为“无 AI 版本”，并强制关闭 discovery 预算（避免内部误触发图谱向量检索）
  let knowledgeBaseServiceForRun: KBService = deps.toolContextBase.knowledgeBaseService;
  if (noAi) {
    const { QdrantRepositoryImpl } = await import(
      'src/features/knowledge-base/infrastructure/QdrantRepositoryImpl'
    );
    const { BetterSqliteMetadataRepository } = await import(
      'src/features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository'
    );
    const { pathManager } = await import('src/shared/utils/pathManager');
    const { FileSotRepository } = await import(
      'src/features/knowledge-base/infrastructure/sotRepository'
    );
    const { BetterSqliteKnowledgeGraphRepository } = await import(
      'src/features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository'
    );

    // 复用 initCliDeps 创建出的依赖：从 toolContextBase 拿到 service 实例，避免重复初始化
    // 这里通过数据库与已初始化的仓储组合构建一个“无 AI 知识库服务”：
    // - qdrantRepository / metadataRepository / sotRepository / knowledgeGraphRepository 在 initCliDeps 内部已创建，
    //   但未暴露；因此在 noAi 模式下，我们直接走 “最小可行策略”：
    //   复用 KnowledgeSearchTool 的 graphPolicy 注入 budget，把 maxDiscoveredBlocks 归零即可，
    //   同时依赖 qdrant 的 keywordSearch 不需要 embedding。
    //
    // 注意：为了不引入 any/断言，我们这里不从 context 里“偷取”私有实例；
    //       因此 noAi 模式会重新构造一次最小依赖（但仍复用同一个 db/qdrant 单例）。
    const qdrantUrl =
      readNonEmptyString(pickFlagValue(argv, '--qdrantUrl')) ??
      readNonEmptyString(process.env.QDRANT_URL) ??
      'http://localhost:6333';
    const qdrantAdapter = QdrantAdapter.getInstance({ url: qdrantUrl });
    const qdrantRepository = new QdrantRepositoryImpl(qdrantAdapter);
    const metadataRepository = new BetterSqliteMetadataRepository(deps.databaseService);
    const sotPath = await pathManager.getSourceOfTruthPath();
    const sotRepository = new FileSotRepository(sotPath);
    const kgRepo = new BetterSqliteKnowledgeGraphRepository(deps.databaseService);

    // baseKnowledgeBaseService 继续用 toolContextBase 里的（生产一致），只作为委托对象
    const base = deps.toolContextBase.knowledgeBaseService;

    // 实际创建（严格类型，不用 any/断言）：
    knowledgeBaseServiceForRun = new CliNoAiKnowledgeBaseService({
      base,
      qdrant: qdrantRepository,
      metadata: metadataRepository,
      sot: sotRepository,
      kgRepo,
    });
  }

  const context: ToolContext = {
    ...deps.toolContextBase,
    knowledgeBaseService: knowledgeBaseServiceForRun,
    workspaceProjectId: projectId,
    // 通过 ToolContext 注入图谱能力档位（业务所有权，模型无权选择）
    graphMode: graphMode,
    ...(noAi
      ? {
          // 关键：强制关闭 discovery 预算，确保 full 也不会触发图谱向量检索
          graphBudget: {
            maxResultsWithGraph: graphMode === 'off' ? 0 : 5,
            maxEntitiesPerResult: graphMode === 'off' ? 0 : 10,
            maxEdgesPerResult: graphMode === 'off' ? 0 : 6,
            maxDiscoveredBlocks: 0,
            minDiscoverySemanticScore: 0.82,
          },
        }
      : {}),
  };
  attachCitationSequence(context, { offset: 0 });

  const tool = new KnowledgeSearchTool();

  const output = await tool.run(toolArgs, context);
  const observation = readObservationFromToolOutput(output);

  if (printMode === 'json') {
    // eslint-disable-next-line no-console
    console.log(output);
    return;
  }

  if (printMode === 'both') {
    // eslint-disable-next-line no-console
    console.log(output);
  }

  // ✅ 对齐“最终发给 AI 的 tool content”：只打印 observation 原文，不添加任何包裹字符
  // eslint-disable-next-line no-console
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

  const qdrantUrl = pickFlagValue(argv, '--qdrantUrl');
  const workspaceDbPath = pickFlagValue(argv, '--workspaceDb');
  const workspaceRoot = pickFlagValue(argv, '--workspaceRoot');
  const deps = await initCliDeps({ qdrantUrl, workspaceDbPath, workspaceRoot });

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

    // eslint-disable-next-line no-console
    console.error(`未知命令: ${command}`);
    showHelp();
    return 1;
  } finally {
    deps.databaseService.close();
  }
}

// eslint-disable-next-line no-console
main()
  .then(code => {
    // CLI 工具必须确定性退出，否则 Electron-run-as-node 会因为残留句柄导致需要手动 Ctrl+C
    process.exit(code);
  })
  .catch(e => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });

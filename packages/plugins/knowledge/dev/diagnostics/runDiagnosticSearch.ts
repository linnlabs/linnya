import path from 'node:path';
import { installRuntimePathRoots } from 'src/shared/runtime-paths';
import type Database from 'better-sqlite3';
import type { EmbeddingPort, RerankingPort } from '@plugin/backend/inferenceRuntime';
import { z } from 'zod';
import { KnowledgeSearchResultSchema } from '@app/schemas';
import { createCitationRefAllocatorFixture } from 'src/domains/citation/testkit/citationRefAllocatorFixture';
import { QdrantAdapter } from '../../src/backend/infrastructure/vector-store';
import { QdrantRepositoryImpl } from '../../src/backend/infrastructure/QdrantRepositoryImpl';
import { BetterSqliteMetadataRepository } from '../../src/backend/infrastructure/sqlite/better-sqlite-metadata.repository';
import { BetterSqliteKnowledgeGraphRepository } from '../../src/backend/graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { FileSotRepository } from '../../src/backend/infrastructure/sotRepository';
import { DefaultSearchService } from '../../src/backend/application/searchService';
import { searchAcrossKnowledgeBases } from '../../src/backend/application/search/searchAcrossKnowledgeBases';
import {
  resolveProjectKnowledgeBaseScope,
  assertDocumentKbAllowedInScope,
} from '../../src/backend/tools/scope/projectKnowledgeBaseScope';
import { resolveGraphPolicyFromContext } from '../../src/backend/tools/search/graphPolicy';
import { buildCitationMetadataFromResults } from '../../src/backend/tools/search/types';
import type { GraphMode } from '../../src/backend/graph/application/graphBudget';
import { createKeywordDiagnosticSearch } from './keywordDiagnosticSearch';

/** 开发观察不创建 Conversation；引用规则复用 Host allocator，仅将 claim 放在本次进程内。 */
export async function runDiagnosticSearch(input: {
  database: Database.Database;
  workspaceRoot: string;
  projectId: string;
  query: string;
  docId?: string;
  topK: number;
  graphMode: GraphMode;
  noAi: boolean;
  qdrantUrl: string;
  initializeModels(): Promise<{ embedding: EmbeddingPort; reranking: RerankingPort }>;
}) {
  installRuntimePathRoots({
    developmentRoot: process.cwd(),
    appDataRoot: input.workspaceRoot,
    profileRoot: path.join(process.cwd(), '_dev_electron'),
    workspaceRoot: input.workspaceRoot,
    workspaceRootIsCustom: true,
  });
  const project = input.database
    .prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .get(input.projectId);
  if (!project) throw new Error(`项目不存在: ${input.projectId}`);
  const links = z
    .object({ kb_id: z.string() })
    .array()
    .parse(
      input.database
        .prepare(
          'SELECT kb_id FROM project_knowledge_base_links WHERE project_id = ? ORDER BY created_at ASC'
        )
        .all(input.projectId)
    );
  const scope = resolveProjectKnowledgeBaseScope(
    input.projectId,
    links.map(link => link.kb_id)
  );
  const metadata = new BetterSqliteMetadataRepository(input.database);
  const document = input.docId ? await metadata.getDocumentById(input.docId) : undefined;
  if (input.docId) {
    if (!document) throw new Error(`Document with ID '${input.docId}' not found.`);
    assertDocumentKbAllowedInScope(scope, document.kbId, input.docId);
  }
  const sot = new FileSotRepository(
    path.join(input.workspaceRoot, 'KnowledgeBase/source_of_truth')
  );
  const graphRepository = new BetterSqliteKnowledgeGraphRepository(input.database);
  const qdrant = new QdrantRepositoryImpl(async () => new QdrantAdapter({ url: input.qdrantUrl }));
  const ports = input.noAi ? null : await input.initializeModels();
  const searchService = !ports
    ? createKeywordDiagnosticSearch({ qdrant, metadata, sot, graph: graphRepository })
    : new DefaultSearchService({
        qdrantRepository: qdrant,
        metadataRepository: metadata,
        sotRepository: sot,
        embedding: ports.embedding,
        reranking: ports.reranking,
        knowledgeGraphRepository: graphRepository,
      });
  const graph = resolveGraphPolicyFromContext({
    graphMode: input.graphMode,
    ...(input.noAi ? { graphBudget: { maxDiscoveredBlocks: 0, maxEntityAnchors: 0 } } : {}),
  });
  const citationRefAllocator = createCitationRefAllocatorFixture();
  const output =
    !document && scope.kbIds.length > 1
      ? await searchAcrossKnowledgeBases(
          { searchService, sotRepository: sot, knowledgeGraphRepository: graphRepository },
          { kbIds: scope.kbIds, query: input.query, topK: input.topK, graph, citationRefAllocator }
        )
      : await searchService.searchForAgent(
          document?.kbId ?? scope.kbIds[0],
          input.query,
          citationRefAllocator,
          input.topK,
          input.docId,
          0,
          graph
        );
  const searchMode = input.docId ? 'document' : 'global';
  return KnowledgeSearchResultSchema.parse({
    data: {
      query: input.query,
      search_strategy: 'shallow',
      search_mode: searchMode,
      doc_name: document?.filename ?? null,
      citations: buildCitationMetadataFromResults(
        output.hits.map(hit => ({
          ref: hit.ref,
          doc_id: hit.docId,
          block_id: hit.blockId,
          doc_name: hit.docName,
          snippet: hit.snippet,
          ...(hit.pageNumber === undefined ? {} : { page: hit.pageNumber }),
        })),
        input.query,
        searchMode,
        document?.filename,
        0
      ),
    },
    observation: output.observation,
  });
}

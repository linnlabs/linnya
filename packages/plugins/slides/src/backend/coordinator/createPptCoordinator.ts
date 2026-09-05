/**
 * @file createPptCoordinator.ts
 * @description Slides coordinator 装配工厂（阶段 5BA：已从 host application 迁入包内）。
 *
 * 中文说明：
 * - 这里负责把 engine（compiler/reader/template）、persistence（repository）、
 *   workspace 节点能力与图片来源解析器装配成 `PptCoordinator`；
 * - workspace 节点操作与日志通过 `@plugin/backend/workspaceRuntime` 窄门面消费；
 * - conversation 图片路径通过 host 注入的窄 port 解析；Markdown 私有媒体不在这里
 *   猜测或提升为跨文档 asset。
 */

import type { Database } from 'better-sqlite3';
import { executeSandboxProfile } from '@plugin/backend/sandboxRuntime';
import { releaseDocumentAssetOwnership } from '@plugin/backend/documentAssetOwnership';
import { CodegenDeckBuilder } from '../codegen';
import { PresentationHistoryRepository, PresentationHistoryRuntime, PresentationRevisionScope, observeRevisionImageBindings, observeRevisionSvgBindings } from '../features/presentationSourceHistory';
import {
  createDocumentImageAssetRuntime,
  type PluginDocumentImageAssetRuntimePort,
} from '@plugin/backend/documentImageAsset';
import {
  createDocumentSvgAssetRuntime,
  type PluginDocumentSvgAssetRuntimePort,
} from '@plugin/backend/documentSvgAsset';
import {
  Logger,
  createWorkspaceService,
  publishWorkspaceDocumentUpdated,
} from '@plugin/backend/workspaceRuntime';
import {
  PatchCompiler,
  PptxReader,
  StructuredCompiler,
  TemplateManager,
  PptPresentationQueryService,
  type SvgGraphicFallbackRasterizerPort,
} from '@plugin/slides/backend-engine-core';
import type { BrushArtworkGeneratorPort } from '../engine/brushArtwork';
import { PresentationDraftRepository, PresentationRepository } from '../persistence';
import {
  createPresentationImageSourceResolver,
  createReadOnlyPresentationImageSourceResolver,
  PresentationImageBindingRepository,
} from '../features/presentationImageOwnership';
import {
  createPresentationSvgGraphicOwner,
  createReadOnlyPresentationSvgGraphicOwner,
  createReadOnlyPresentationSvgGraphicAssetResolver,
  PresentationSvgGraphicBindingRepository,
} from '../features/presentationSvgGraphicOwnership';
import { createPresentationSvgGraphicFallbackRasterizer } from '../features/presentationSvgGraphicFallback';
import { PptCoordinator } from './PptCoordinator';
import type { PluginConversationFilePathResolverPort } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import type { PresentationBuildExecutionPort } from '../features/presentationBuildExecution';
import { createPresentationBuildDeckAssembler } from '../features/presentationBuildExecution';

export function createPptCoordinator(
  db: Database,
  options: {
    readonly conversationFilePathResolver?: PluginConversationFilePathResolverPort;
    readonly documentImageAssetRuntime?: PluginDocumentImageAssetRuntimePort;
    readonly documentSvgAssetRuntime?: PluginDocumentSvgAssetRuntimePort;
    readonly svgGraphicFallbackRasterizer?: SvgGraphicFallbackRasterizerPort;
    readonly brushArtworkGenerator?: BrushArtworkGeneratorPort;
    readonly buildExecution: PresentationBuildExecutionPort;
  }
): PptCoordinator {
  const deckAssemblerLogger = new Logger('DeckAssembler');
  const codegenFailureLogger = new Logger('SlidesCodegen');
  const workspaceService = createWorkspaceService(db);
  const revisionScope = new PresentationRevisionScope();
  const historyRepository = new PresentationHistoryRepository(db);
  let history: PresentationHistoryRuntime;
  const presentationRepo = new PresentationRepository(db, {
    publishDocumentUpdated: publishWorkspaceDocumentUpdated,
    recordRevisionContext: (nodeId, revisionId, deck) => historyRepository.recordContext(revisionId, deck, revisionScope.read(nodeId)),
    requestHistoryMaintenance: nodeId => history.requestMaintenance(nodeId),
  });
  const presentationDraftRepo = new PresentationDraftRepository(db);
  const structuredCompiler = new StructuredCompiler();
  const imageBindings = observeRevisionImageBindings(new PresentationImageBindingRepository(db), revisionScope);
  const svgBindings = observeRevisionSvgBindings(new PresentationSvgGraphicBindingRepository(db), revisionScope);
  const imageAssets = options.documentImageAssetRuntime ?? createDocumentImageAssetRuntime(db);
  const svgAssets = options.documentSvgAssetRuntime ?? createDocumentSvgAssetRuntime(db);
  const imageSourceResolver = createPresentationImageSourceResolver({
    bindingRepository: imageBindings,
    documentImageAssets: imageAssets,
    ...(options.brushArtworkGenerator
      ? { brushArtworkGenerator: options.brushArtworkGenerator }
      : {}),
    ...(options.conversationFilePathResolver
      ? { conversationFilePathResolver: options.conversationFilePathResolver }
      : {}),
  });
  const svgGraphicRuntime = createPresentationSvgGraphicOwner({
    bindingRepository: svgBindings,
    documentSvgAssets: svgAssets,
    ...(options.conversationFilePathResolver
      ? { conversationFilePathResolver: options.conversationFilePathResolver }
      : {}),
  });
  const deckAssembler = createPresentationBuildDeckAssembler({
    execution: options.buildExecution,
    imageSourceResolver,
    logger: deckAssemblerLogger,
    svgGraphicAssetResolver: svgGraphicRuntime,
    svgGraphicFallbackRasterizer: options.svgGraphicFallbackRasterizer
      ?? createPresentationSvgGraphicFallbackRasterizer(),
  });
  const pptxReader = new PptxReader();
  const templateManager = new TemplateManager(pptxReader, presentationRepo);
  const patchCompiler = new PatchCompiler(structuredCompiler, templateManager, pptxReader);

  const historicalImages = createReadOnlyPresentationImageSourceResolver({ bindingReader: imageBindings, documentImageAssets: imageAssets });
  const historicalSvgOwner = createReadOnlyPresentationSvgGraphicOwner({ bindingRepository: svgBindings, documentSvgAssets: svgAssets });
  const historicalSvgReader = createReadOnlyPresentationSvgGraphicAssetResolver({ documentSvgAssets: svgAssets });
  const historicalAssembler = createPresentationBuildDeckAssembler({
    execution: options.buildExecution, imageSourceResolver: historicalImages, svgGraphicAssetResolver: historicalSvgReader,
    svgGraphicFallbackRasterizer: options.svgGraphicFallbackRasterizer ?? createPresentationSvgGraphicFallbackRasterizer(),
  });
  const historicalBuilder = new CodegenDeckBuilder({
    presentationRepo, engine: { assembleDeck: request => historicalAssembler.assemble(request.deckSpec, request.assembleOptions) },
    sandbox: { execute: executeSandboxProfile }, buildExecution: options.buildExecution, svgGraphicOwner: historicalSvgOwner,
  });
  const historicalQueries = new PptPresentationQueryService(pptxReader, historicalImages, historicalSvgReader);
  history = new PresentationHistoryRuntime({
    history: historyRepository, documents: presentationRepo, scope: revisionScope,
    compile: input => historicalBuilder.buildHistoricalDeckSpec(input),
    render: (documentId, version, deckSpec) => historicalQueries.getRenderModel(documentId, {
      id: version.versionId, nodeId: documentId, versionNumber: version.order, deckSpec,
      title: deckSpec.title, sourceKind: 'generated', pptxBuffer: Buffer.alloc(0),
    }, { assetContext: { documentId } }),
    assemble: (documentId, deck) => historicalAssembler.assemble(deck, { assetContext: { documentId } }),
    release: (documentId, assetIds) => releaseDocumentAssetOwnership({ database: db, documentId, assetIds }),
    reportFailure: (documentId, error) => codegenFailureLogger.error('slides_history.maintenance.failed', { documentId, error: error instanceof Error ? error.message : String(error) }),
  });

  return new PptCoordinator(
    deckAssembler,
    patchCompiler,
    pptxReader,
    templateManager,
    presentationRepo,
    {
      async createPresentationNode(options) {
        const node = workspaceService.createNode({
          type: 'presentation',
          name: options.title,
          projectId: options.projectId,
          parentId: options.parentId ?? null,
        });
        return node.id;
      },
      async deletePresentationNode(nodeId) {
        workspaceService.deleteNode(nodeId);
      },
      async getPresentationProjectId(nodeId) {
        return workspaceService.getNode(nodeId)?.project_id ?? null;
      },
    },
    imageSourceResolver,
    presentationDraftRepo,
    {
      codegenFailureLogger,
      revisionScope,
      history,
      svgGraphicRuntime,
      buildExecution: options.buildExecution,
    }
  );
}

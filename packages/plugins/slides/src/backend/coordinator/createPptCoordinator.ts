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
  type SvgGraphicFallbackRasterizerPort,
} from '@plugin/slides/backend-engine-core';
import type { BrushArtworkGeneratorPort } from '../engine/brushArtwork';
import { PresentationDraftRepository, PresentationRepository } from '../persistence';
import {
  createPresentationImageSourceResolver,
  PresentationImageBindingRepository,
} from '../features/presentationImageOwnership';
import {
  createPresentationSvgGraphicOwner,
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
  const presentationRepo = new PresentationRepository(db, {
    publishDocumentUpdated: publishWorkspaceDocumentUpdated,
  });
  const presentationDraftRepo = new PresentationDraftRepository(db);
  const structuredCompiler = new StructuredCompiler();
  const imageSourceResolver = createPresentationImageSourceResolver({
    bindingRepository: new PresentationImageBindingRepository(db),
    documentImageAssets: options.documentImageAssetRuntime ?? createDocumentImageAssetRuntime(db),
    ...(options.brushArtworkGenerator
      ? { brushArtworkGenerator: options.brushArtworkGenerator }
      : {}),
    ...(options.conversationFilePathResolver
      ? { conversationFilePathResolver: options.conversationFilePathResolver }
      : {}),
  });
  const svgGraphicRuntime = createPresentationSvgGraphicOwner({
    bindingRepository: new PresentationSvgGraphicBindingRepository(db),
    documentSvgAssets: options.documentSvgAssetRuntime ?? createDocumentSvgAssetRuntime(db),
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
      svgGraphicRuntime,
      buildExecution: options.buildExecution,
    }
  );
}

/**
 * PptCoordinator
 *
 * PPT 生成总协调器：串联编译器、workspace、数据库
 */

import type {
  PresentationInspectionRequest,
  SlidesDocumentBuildState,
  SlidesSourceSliceTargetInput,
  SlidesSourceSlicesOutput,
  TemplateSpec,
  TemplateSummary,
} from '@plugin/slides/shared';
import type { PresentationInspectionResult } from '../features/presentationInspection';
import type {
  DeckAssemblerPort,
  ExportedPresentationFile,
  GeneratePresentationOptions,
  GeneratePresentationResult,
  ImageSourceResolverPort,
  PatchCompilerPort,
  PresentationDraftRepositoryPort,
  PresentationRepositoryPort,
  PptxReaderPort,
  TemplateManagerPort,
  WorkspacePresentationPort,
} from './types.js';
import type { RestorePresentationRevisionResult } from './types.js';
import type { DeckPreview, PresentationInfo, PresentationRenderModel } from '@plugin/slides/shared';
import type {
  CodegenDeckBuilderFailureLogger,
  CodegenPresentationService,
} from '../codegen';
import {
  createSlidesEngineExecutionContext,
  InProcessSlidesEngineExecutionAdapter,
  PptPresentationQueryService,
  type SlidesEngineExecutionAdapter,
} from '@plugin/slides/backend-engine-core';
import { buildToolFeedbackPayloadAsync } from '@plugin/slides/backend-tools';
import { PresentationQueryRuntime } from './presentationQueryRuntime';
import {
  PresentationCodegenRuntime,
  type CodegenDeckBuilderFactory,
} from './presentationCodegenRuntime';
import {
  PresentationScreenshotRuntime,
  type PresentationScreenshotRequest,
  type PresentationScreenshotResult,
} from '../features/presentationScreenshot';
import {
  buildSourceLocationMap,
  PresentationInspectionRuntime,
} from '../features/presentationInspection';
import type { PluginConversationFilePathResolverPort } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import type { ConversationAwarePresentationImageSourceResolver } from '../features/presentationImageOwnership';
import type { ConversationAwarePresentationSvgGraphicOwnerPort } from '../features/presentationSvgGraphicOwnership';
import type { PresentationBuildExecutionPort } from '../features/presentationBuildExecution';
import { commitExportArtifact } from '@plugin/backend/exportArtifact';
import { renderRasterPdfDocument } from '@plugin/backend/pdfDocumentRuntime';
import {
  PresentationExportRuntime,
  reportPresentationImageExportProgress,
  type PresentationExportRuntimePorts,
} from '../features/presentationExport';
import { PresentationPageRasterizationRuntime } from '../features/presentationPageRasterization';
import type {
  PresentationExportRequest,
  PresentationExportResult,
} from '@plugin/slides/shared';

function isConversationAwareImageSourceResolver(
  resolver: ImageSourceResolverPort | undefined
): resolver is ConversationAwarePresentationImageSourceResolver {
  return (
    resolver !== undefined &&
    typeof Reflect.get(resolver, 'bindConversationFilePathResolver') === 'function'
  );
}

export interface PptCoordinatorRuntimeOptions {
  readonly engineAdapter?: SlidesEngineExecutionAdapter;
  readonly codegenDeckBuilderFactory?: CodegenDeckBuilderFactory;
  readonly codegenFailureLogger?: CodegenDeckBuilderFailureLogger;
  readonly svgGraphicRuntime?: ConversationAwarePresentationSvgGraphicOwnerPort;
  readonly commitExportArtifact?: PresentationExportRuntimePorts['commitArtifact'];
  readonly buildExecution: PresentationBuildExecutionPort;
}

export class PptCoordinator {
  private readonly engine: SlidesEngineExecutionAdapter;
  private readonly codegenRuntime: PresentationCodegenRuntime;
  private readonly queryRuntime: PresentationQueryRuntime;
  private readonly screenshotRuntime: PresentationScreenshotRuntime;
  private readonly inspectionRuntime: PresentationInspectionRuntime;
  private readonly presentationExportRuntime: PresentationExportRuntime;
  private readonly svgGraphicRuntime?: ConversationAwarePresentationSvgGraphicOwnerPort;

  constructor(
    deckAssembler: DeckAssemblerPort,
    patchCompiler: PatchCompilerPort,
    pptxReader: PptxReaderPort,
    private readonly templateManager: TemplateManagerPort,
    private readonly presentationRepo: PresentationRepositoryPort,
    private readonly workspaceService: WorkspacePresentationPort | undefined,
    private readonly imageSourceResolver: ImageSourceResolverPort | undefined,
    private readonly draftRepo: PresentationDraftRepositoryPort | undefined,
    runtimeOptions: PptCoordinatorRuntimeOptions
  ) {
    this.svgGraphicRuntime = runtimeOptions.svgGraphicRuntime;
    const presentationQueries = new PptPresentationQueryService(
      pptxReader,
      imageSourceResolver,
      runtimeOptions.svgGraphicRuntime,
    );
    this.engine =
      runtimeOptions.engineAdapter ??
      new InProcessSlidesEngineExecutionAdapter({
        deckAssembler,
        patchCompiler,
        pptxReader,
        presentationQueries,
      });
    this.codegenRuntime = new PresentationCodegenRuntime({
      presentationRepo: this.presentationRepo,
      ...(this.workspaceService ? { workspaceService: this.workspaceService } : {}),
      ...(this.draftRepo ? { draftRepo: this.draftRepo } : {}),
      engine: this.engine,
      ...(runtimeOptions.codegenDeckBuilderFactory
        ? { codegenDeckBuilderFactory: runtimeOptions.codegenDeckBuilderFactory }
        : {}),
      ...(runtimeOptions.codegenFailureLogger
        ? { failureLogger: runtimeOptions.codegenFailureLogger }
        : {}),
      ...(runtimeOptions.svgGraphicRuntime
        ? { svgGraphicOwner: runtimeOptions.svgGraphicRuntime }
        : {}),
      buildExecution: runtimeOptions.buildExecution,
    });
    this.queryRuntime = new PresentationQueryRuntime({
      presentationRepo: this.presentationRepo,
      ...(this.workspaceService ? { workspaceService: this.workspaceService } : {}),
      ...(this.draftRepo ? { draftRepo: this.draftRepo } : {}),
      engine: this.engine,
      getCodegenDeckBuilder: () => this.codegenRuntime.getDeckBuilder(),
    });
    const exportPageRasterization = new PresentationPageRasterizationRuntime();
    this.presentationExportRuntime = new PresentationExportRuntime({
      loadNativePptx: nodeId => this.queryRuntime.export(nodeId),
      loadRasterSource: async nodeId => {
        const snapshot = await this.queryRuntime.getRenderModelSnapshot(nodeId);
        return {
          renderModel: snapshot.renderModel,
          sourcePackageBytes: snapshot.version.pptxBuffer,
          deckSpec: snapshot.version.deckSpec,
        };
      },
      rasterizePages: (request, options) => exportPageRasterization.render(request, options),
      reportImageProgress: reportPresentationImageExportProgress,
      renderRasterPdf: renderRasterPdfDocument,
      assembleDeck: async (nodeId, deckSpec) => {
        const projectId = await this.workspaceService?.getPresentationProjectId?.(nodeId) ?? null;
        return await this.engine.assembleDeck({
          deckSpec,
          assembleOptions: {
            assetContext: {
              documentId: nodeId,
              ...(projectId ? { projectId } : {}),
            },
          },
          context: createSlidesEngineExecutionContext('assembleDeck', {
            nodeId,
            ...(projectId ? { projectId } : {}),
          }),
        });
      },
      commitArtifact: runtimeOptions.commitExportArtifact ?? commitExportArtifact,
    });
    this.screenshotRuntime = new PresentationScreenshotRuntime({
      loadSource: async nodeId => {
        const snapshot = await this.queryRuntime.getRenderModelSnapshot(nodeId);
        return {
          identity: {
            presentationId: snapshot.renderModel.presentationId,
            title: snapshot.renderModel.title,
            versionId: snapshot.version.id,
            versionNumber: snapshot.version.versionNumber,
            sourceKind: snapshot.version.sourceKind,
          },
          renderModel: snapshot.renderModel,
          sourcePackageBytes: snapshot.version.pptxBuffer,
        };
      },
    });
    this.inspectionRuntime = new PresentationInspectionRuntime({
      loadSnapshot: async nodeId => {
        const snapshot = await this.queryRuntime.getRenderModelSnapshot(nodeId);
        return {
          versionId: snapshot.version.id,
          renderModel: snapshot.renderModel,
        };
      },
      loadSourceLocations: async renderModel => {
        if (renderModel.sourceKind !== 'generated') {
          return undefined;
        }
        try {
          const structure = await this.codegenRuntime.getPresentationService().structure({
            presentation_id: renderModel.presentationId,
          });
          return buildSourceLocationMap(structure);
        } catch (error) {
          if (readCodegenErrorCode(error) === 5) {
            return undefined;
          }
          throw error;
        }
      },
      buildFeedback: async (
        presentationId,
        versionId,
        renderModel,
        editableTargetsBySlide,
        options
      ) =>
        buildToolFeedbackPayloadAsync(
          presentationId,
          versionId,
          renderModel,
          editableTargetsBySlide,
          {
            includeHeuristics: options.includeHeuristics,
            sourceSpanUseCounts: options.sourceSpanUseCounts,
            ...(options.focus ? { focus: options.focus } : {}),
            ...(options.sourceLocations ? { sourceLocations: options.sourceLocations } : {}),
            spatialAnalyzer: this.engine,
          }
        ),
    });
  }

  /**
   * IPC/document hook 可能先于 Agent 工具创建共享 coordinator；工具上下文
   * 到达时再绑定宿主 admission，避免重建 coordinator 丢失既有 read-state。
   */
  bindConversationFilePathResolver(resolver: PluginConversationFilePathResolverPort): void {
    if (isConversationAwareImageSourceResolver(this.imageSourceResolver)) {
      this.imageSourceResolver.bindConversationFilePathResolver(resolver);
    }
    this.svgGraphicRuntime?.bindConversationFilePathResolver(resolver);
  }

  /** 创建一份可立即预览/导出的空白 presentation（版本 1） */
  async createEmptyPresentation(
    options: GeneratePresentationOptions & { title?: string }
  ): Promise<GeneratePresentationResult> {
    return this.codegenRuntime.createEmptyPresentation(options);
  }

  /** 解析已有 PPTX 结构，并为元素回写稳定 elementId */
  async inspect(nodeId: string): Promise<PresentationInfo> {
    return this.queryRuntime.inspect(nodeId);
  }

  /** 导出 PPTX 文件 */
  async export(nodeId: string): Promise<ExportedPresentationFile> {
    return this.queryRuntime.export(nodeId);
  }

  /** 把派生 artifact 写入 renderer 已授权的一次性 Host 目标。 */
  async exportPresentation(
    request: PresentationExportRequest,
  ): Promise<PresentationExportResult> {
    return this.presentationExportRuntime.export(request);
  }

  /** 获取预览数据（正式 DeckPreview 模型） */
  async getPreview(nodeId: string): Promise<DeckPreview> {
    return this.queryRuntime.getPreview(nodeId);
  }

  /** 查询源码是否已有同版本可渲染物化；draft 是正常业务状态，不通过异常表达。 */
  async getDocumentBuildState(nodeId: string): Promise<SlidesDocumentBuildState> {
    return this.queryRuntime.getDocumentBuildState(nodeId);
  }

  /** 获取完整渲染模型（Konva 渲染层消费） */
  async getRenderModel(nodeId: string): Promise<PresentationRenderModel> {
    return this.queryRuntime.getRenderModel(nodeId);
  }

  /** 以同一版本快照生成可供 CLI / CI 消费的 PNG/JPEG 页面批次。 */
  async renderScreenshots(
    request: PresentationScreenshotRequest,
    options?: { readonly signal?: AbortSignal }
  ): Promise<PresentationScreenshotResult> {
    return this.screenshotRuntime.render(request, options);
  }

  /** 为工具与 CLI 生成同源结构检查或诊断事实。 */
  async inspectPresentation(
    request: PresentationInspectionRequest
  ): Promise<PresentationInspectionResult> {
    return this.inspectionRuntime.inspect(request);
  }

  /** 查询演示文稿的来源类型 */
  async getSourceKind(nodeId: string): Promise<import('./types.js').PresentationSourceKind> {
    return this.queryRuntime.getSourceKind(nodeId);
  }

  getCodegenPresentationService(): CodegenPresentationService {
    return this.codegenRuntime.getPresentationService();
  }

  async restoreRevision(
    nodeId: string,
    revision: number
  ): Promise<RestorePresentationRevisionResult> {
    const restored = await this.codegenRuntime.restoreRevision(nodeId, revision);
    return {
      nodeId,
      versionId: restored.versionId,
      versionNumber: restored.versionNumber,
    };
  }

  async readSourceSlicesForAiEdit(input: {
    presentationId: string;
    conversationId: string;
    targets: SlidesSourceSliceTargetInput[];
  }): Promise<SlidesSourceSlicesOutput> {
    return this.codegenRuntime.readSourceSlicesForAiEdit(input);
  }

  /** 导入模板 */
  async importTemplate(buffer: Buffer, name: string, description?: string): Promise<TemplateSpec> {
    return this.templateManager.importFromPptx(buffer, name, description);
  }

  /** 列出模板 */
  async listTemplates(): Promise<TemplateSummary[]> {
    return this.presentationRepo.listTemplates();
  }

  /** 获取模板主题（工具/编排层使用） */
  async getTemplateTheme(templateId: string) {
    return this.templateManager.getTheme(templateId);
  }

  /** 获取模板完整记录（工具/编排层使用） */
  async getTemplate(templateId: string) {
    if (!this.templateManager.getTemplate) {
      throw new Error('Template manager does not support getTemplate.');
    }
    return this.templateManager.getTemplate(templateId);
  }
}

function readCodegenErrorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('errorCode' in error)) {
    return null;
  }
  const errorCode = Reflect.get(error, 'errorCode');
  return typeof errorCode === 'number' ? errorCode : null;
}

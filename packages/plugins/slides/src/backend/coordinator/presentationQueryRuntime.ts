import type {
  DeckPreview,
  PresentationInfo,
  PresentationRenderModel,
  SlidesDocumentBuildState,
} from '@plugin/slides/shared';
import { toSlidesDraftStatus } from '../persistence';
import type {
  DeckAssembleOptions,
  ExportedPresentationFile,
  PresentationDraftRepositoryPort,
  PresentationDocumentRecord,
  PresentationRepositoryPort,
  PresentationSourceKind,
  WorkspacePresentationPort,
} from './types.js';
import {
  createSlidesEngineExecutionContext,
  type SlidesEngineExecutionAdapter,
  type SlidesEngineExecutionScope,
  type SlidesEngineVersionSnapshot,
} from '@plugin/slides/backend-engine-core';
import type { CodegenDeckBuilderPort } from './presentationCodegenRuntime';
import { toSlidesEngineVersionSnapshot } from './functions/presentationDocumentSnapshot.js';
import { deckSpecHasSourceSpan } from '../engine/coordinator/deckSpecSourceSpans.js';

interface RenderModelVersionResolution {
  readonly version: SlidesEngineVersionSnapshot;
  readonly canEditSourceSelection: boolean;
}

export interface PresentationRenderModelSnapshot {
  readonly version: SlidesEngineVersionSnapshot;
  readonly renderModel: PresentationRenderModel;
}

export interface PresentationQueryRuntimeDeps {
  readonly presentationRepo: PresentationRepositoryPort;
  readonly workspaceService?: WorkspacePresentationPort;
  readonly draftRepo?: PresentationDraftRepositoryPort;
  readonly engine: SlidesEngineExecutionAdapter;
  readonly getCodegenDeckBuilder: () => CodegenDeckBuilderPort;
}

/**
 * 演示文稿只读查询运行时。
 *
 * 中文说明：
 * - 这里集中 compiled-version 查询路径：inspect/export/preview/render model/source kind；
 * - mutation 路径仍留在 PptCoordinator，避免 query 与编辑保存逻辑互相牵连；
 * - sourceSpan 恢复属于 render-model 查询能力，也收在这里，防止 coordinator 继续膨胀。
 */
export class PresentationQueryRuntime {
  constructor(private readonly deps: PresentationQueryRuntimeDeps) {}

  async inspect(nodeId: string): Promise<PresentationInfo> {
    const document = await this.requirePresentation(nodeId);
    const version = toSlidesEngineVersionSnapshot(document);
    this.assertNoPendingCodegenDraft(nodeId, 'inspect');
    return this.deps.engine.inspectPresentation({
      nodeId,
      version,
      assembleOptions: this.buildDeckAssembleOptions(
        nodeId,
        await this.resolvePresentationProjectId(nodeId)
      ),
      context: this.createEngineContext('inspectPresentation', {
        nodeId,
        versionId: version.id,
      }),
    });
  }

  async export(nodeId: string): Promise<ExportedPresentationFile> {
    const document = await this.requirePresentation(nodeId);
    const version = toSlidesEngineVersionSnapshot(document);
    this.assertNoPendingCodegenDraft(nodeId, 'export');
    return this.deps.engine.exportPresentation({
      nodeId,
      version,
      assembleOptions: this.buildDeckAssembleOptions(
        nodeId,
        await this.resolvePresentationProjectId(nodeId)
      ),
      context: this.createEngineContext('exportPresentation', {
        nodeId,
        versionId: version.id,
      }),
    });
  }

  async getPreview(nodeId: string): Promise<DeckPreview> {
    const document = await this.requirePresentation(nodeId);
    const version = toSlidesEngineVersionSnapshot(document);
    this.assertNoPendingCodegenDraft(nodeId, 'preview');
    return this.deps.engine.buildPreview({
      nodeId,
      version,
      assembleOptions: this.buildDeckAssembleOptions(
        nodeId,
        await this.resolvePresentationProjectId(nodeId)
      ),
      context: this.createEngineContext('buildPreview', {
        nodeId,
        versionId: version.id,
      }),
    });
  }

  async getRenderModel(nodeId: string): Promise<PresentationRenderModel> {
    return (await this.getRenderModelSnapshot(nodeId)).renderModel;
  }

  async getRenderModelSnapshot(nodeId: string): Promise<PresentationRenderModelSnapshot> {
    const document = await this.requirePresentation(nodeId);
    const version = toSlidesEngineVersionSnapshot(document);
    this.assertNoPendingCodegenDraft(nodeId, 'render model');
    const projectId = await this.resolvePresentationProjectId(nodeId);
    const renderModelVersion = await this.resolveRenderModelVersionWithSourceSpans(nodeId, version);
    const renderModel = await this.deps.engine.buildRenderModel({
      nodeId,
      version: renderModelVersion.version,
      assembleOptions: this.buildDeckAssembleOptions(nodeId, projectId),
      context: this.createEngineContext('buildRenderModel', {
        nodeId,
        versionId: renderModelVersion.version.id,
      }),
      renderModelOptions: {
        canEditSourceSelection: renderModelVersion.canEditSourceSelection,
      },
    });
    return {
      version: renderModelVersion.version,
      renderModel,
    };
  }

  async getSourceKind(nodeId: string): Promise<PresentationSourceKind> {
    await this.requirePresentation(nodeId);
    return 'generated';
  }

  async getDocumentBuildState(nodeId: string): Promise<SlidesDocumentBuildState> {
    const document = await this.requirePresentation(nodeId);
    const draft = this.deps.draftRepo?.get(nodeId) ?? null;
    if (draft) {
      return {
        state: 'draft',
        presentationId: nodeId,
        versionId: document.currentRevisionId,
        versionNumber: document.currentRevision,
        draftStatus: toSlidesDraftStatus(draft),
      };
    }
    return {
      state: 'ready',
      presentationId: nodeId,
      versionId: document.currentRevisionId,
      versionNumber: document.currentRevision,
    };
  }

  private async requirePresentation(nodeId: string): Promise<PresentationDocumentRecord> {
    const document = await this.deps.presentationRepo.getPresentation(nodeId);
    if (!document) {
      throw new Error(`Presentation not found: ${nodeId}`);
    }
    return document;
  }

  private buildDeckAssembleOptions(nodeId: string, projectId: string | null): DeckAssembleOptions {
    return {
      assetContext: {
        documentId: nodeId,
        ...(projectId ? { projectId } : {}),
      },
    };
  }

  private async resolvePresentationProjectId(nodeId: string): Promise<string | null> {
    return (await this.deps.workspaceService?.getPresentationProjectId?.(nodeId)) ?? null;
  }

  private createEngineContext(
    operation: Parameters<typeof createSlidesEngineExecutionContext>[0],
    scope: SlidesEngineExecutionScope = {}
  ) {
    return createSlidesEngineExecutionContext(operation, scope);
  }

  private assertNoPendingCodegenDraft(nodeId: string, operation: string): void {
    if (!this.deps.draftRepo?.has(nodeId)) {
      return;
    }
    throw new Error(
      `${operation} cannot use the latest compiled checkpoint because this deck has an unresolved deck.js draft. ` +
        'Use read_file and edit_file to fix it; successful compilation will clear the draft.'
    );
  }

  private async resolveRenderModelVersionWithSourceSpans(
    nodeId: string,
    version: SlidesEngineVersionSnapshot
  ): Promise<RenderModelVersionResolution> {
    if (!version.deckSource?.trim()) {
      return {
        version,
        canEditSourceSelection: false,
      };
    }

    if (deckSpecHasSourceSpan(version.deckSpec)) {
      return {
        version,
        canEditSourceSelection: true,
      };
    }

    try {
      const deckSpec = await this.deps.getCodegenDeckBuilder().buildDeckSpecFromSource({
        nodeId,
        source: version.deckSource,
      });
      return {
        version: {
          ...version,
          deckSpec,
        },
        canEditSourceSelection: deckSpecHasSourceSpan(deckSpec),
      };
    } catch (error) {
      console.warn('[ai-ppt] failed to recover source spans for render model', {
        nodeId,
        versionId: version.id,
        error,
      });
      return {
        version,
        canEditSourceSelection: false,
      };
    }
  }
}

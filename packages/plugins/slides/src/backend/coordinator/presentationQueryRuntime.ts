import type {
  DeckSpec,
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
  PresentationDocumentIdentity,
  PresentationDocumentQueryPort,
  PresentationPreviewSourceRecord,
  PresentationRenderSourceRecord,
  PresentationSourceKind,
  WorkspacePresentationPort,
} from './types.js';
import type { PresentationPptxArtifactPort } from '../features/presentationPptxArtifact/index.js';
import {
  createSlidesEngineExecutionContext,
  type SlidesEngineExecutionAdapter,
  type SlidesEngineExecutionScope,
  type SlidesEngineRenderModelSnapshot,
} from '@plugin/slides/backend-engine-core';
import type { CodegenDeckBuilderPort } from './presentationCodegenRuntime';
import {
  toSlidesEnginePreviewSnapshot,
  toSlidesEngineRenderModelSnapshot,
  toSlidesEngineVersionSnapshot,
} from './functions/presentationDocumentSnapshot.js';
import { deckSpecHasSourceSpan } from '../engine/coordinator/deckSpecSourceSpans.js';

interface RenderModelDeckSpecResolution {
  readonly deckSpec: DeckSpec;
  readonly canEditSourceSelection: boolean;
}

export interface PresentationRenderModelSnapshot {
  readonly version: SlidesEngineRenderModelSnapshot;
  readonly renderModel: PresentationRenderModel;
}

export interface PresentationQueryRuntimeDeps {
  readonly presentationRepo: PresentationDocumentQueryPort;
  readonly workspaceService?: WorkspacePresentationPort;
  readonly draftRepo?: PresentationDraftRepositoryPort;
  readonly engine: SlidesEngineExecutionAdapter;
  readonly getCodegenDeckBuilder: () => CodegenDeckBuilderPort;
  readonly pptxArtifacts: PresentationPptxArtifactPort;
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
    this.assertNoPendingCodegenDraft(nodeId, 'inspect');
    const document = await this.deps.pptxArtifacts.loadCurrent(nodeId);
    const version = toSlidesEngineVersionSnapshot(document);
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
    this.assertNoPendingCodegenDraft(nodeId, 'export');
    const document = await this.deps.pptxArtifacts.loadCurrent(nodeId);
    const version = toSlidesEngineVersionSnapshot(document);
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
    const source = await this.requirePresentationPreviewSource(nodeId);
    const version = toSlidesEnginePreviewSnapshot(source);
    this.assertNoPendingCodegenDraft(nodeId, 'preview');
    return this.deps.engine.buildPreview({
      nodeId,
      version,
      context: this.createEngineContext('buildPreview', {
        nodeId,
        versionId: version.id,
      }),
    });
  }

  async getRenderModel(nodeId: string): Promise<PresentationRenderModel> {
    const source = await this.requirePresentationRenderSource(nodeId);
    const version = toSlidesEngineRenderModelSnapshot(source);
    this.assertNoPendingCodegenDraft(nodeId, 'render model');
    const resolution = await this.resolveRenderModelDeckSpec(nodeId, version);
    return await this.buildRenderModel(
      nodeId,
      { ...version, deckSpec: resolution.deckSpec },
      resolution.canEditSourceSelection,
    );
  }

  async getRenderModelSnapshot(nodeId: string): Promise<PresentationRenderModelSnapshot> {
    const source = await this.requirePresentationRenderSource(nodeId);
    const version = toSlidesEngineRenderModelSnapshot(source);
    this.assertNoPendingCodegenDraft(nodeId, 'render model');
    const resolution = await this.resolveRenderModelDeckSpec(nodeId, version);
    const renderModelVersion = { ...version, deckSpec: resolution.deckSpec };
    const renderModel = await this.buildRenderModel(
      nodeId,
      renderModelVersion,
      resolution.canEditSourceSelection,
    );
    return {
      version: renderModelVersion,
      renderModel,
    };
  }

  async getSourceKind(nodeId: string): Promise<PresentationSourceKind> {
    await this.requirePresentationIdentity(nodeId);
    return 'generated';
  }

  async getDocumentBuildState(nodeId: string): Promise<SlidesDocumentBuildState> {
    const document = await this.requirePresentationIdentity(nodeId);
    const draft = this.deps.draftRepo?.get(nodeId) ?? null;
    if (draft) {
      return {
        state: 'draft',
        presentationId: nodeId,
        versionId: document.currentRevisionId,
        versionNumber: document.currentRevision,
        sourceHash: document.sourceHash,
        draftStatus: toSlidesDraftStatus(draft),
      };
    }
    return {
      state: 'ready',
      presentationId: nodeId,
      versionId: document.currentRevisionId,
      versionNumber: document.currentRevision,
      sourceHash: document.sourceHash,
    };
  }

  private async requirePresentationIdentity(nodeId: string): Promise<PresentationDocumentIdentity> {
    const identity = await this.deps.presentationRepo.getPresentationIdentity(nodeId);
    if (!identity) {
      throw new Error(`Presentation not found: ${nodeId}`);
    }
    return identity;
  }

  private async requirePresentationPreviewSource(
    nodeId: string,
  ): Promise<PresentationPreviewSourceRecord> {
    const source = await this.deps.presentationRepo.getPresentationPreviewSource(nodeId);
    if (!source) {
      throw new Error(`Presentation not found: ${nodeId}`);
    }
    return source;
  }

  private async requirePresentationRenderSource(
    nodeId: string,
  ): Promise<PresentationRenderSourceRecord> {
    const source = await this.deps.presentationRepo.getPresentationRenderSource(nodeId);
    if (!source) {
      throw new Error(`Presentation not found: ${nodeId}`);
    }
    return source;
  }

  private async buildRenderModel(
    nodeId: string,
    version: SlidesEngineRenderModelSnapshot,
    canEditSourceSelection: boolean,
  ): Promise<PresentationRenderModel> {
    const projectId = await this.resolvePresentationProjectId(nodeId);
    return await this.deps.engine.buildRenderModel({
      nodeId,
      version,
      assembleOptions: this.buildDeckAssembleOptions(nodeId, projectId),
      context: this.createEngineContext('buildRenderModel', {
        nodeId,
        versionId: version.id,
      }),
      renderModelOptions: { canEditSourceSelection },
    });
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

  private async resolveRenderModelDeckSpec(
    nodeId: string,
    version: Pick<SlidesEngineRenderModelSnapshot, 'id' | 'deckSource' | 'deckSpec'>,
  ): Promise<RenderModelDeckSpecResolution> {
    if (!version.deckSource?.trim()) {
      return {
        deckSpec: version.deckSpec,
        canEditSourceSelection: false,
      };
    }

    if (deckSpecHasSourceSpan(version.deckSpec)) {
      return {
        deckSpec: version.deckSpec,
        canEditSourceSelection: true,
      };
    }

    try {
      const deckSpec = await this.deps.getCodegenDeckBuilder().buildDeckSpecFromSource({
        nodeId,
        source: version.deckSource,
      });
      return {
        deckSpec,
        canEditSourceSelection: deckSpecHasSourceSpan(deckSpec),
      };
    } catch (error) {
      console.warn('[ai-ppt] failed to recover source spans for render model', {
        nodeId,
        versionId: version.id,
        error,
      });
      return {
        deckSpec: version.deckSpec,
        canEditSourceSelection: false,
      };
    }
  }
}

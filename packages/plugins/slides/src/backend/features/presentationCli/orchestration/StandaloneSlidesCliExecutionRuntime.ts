import type { Database } from 'better-sqlite3';
import { createDocumentImageAssetRuntime } from '@plugin/backend/documentImageAsset';
import { createDocumentSvgAssetRuntime } from '@plugin/backend/documentSvgAsset';
import { SlideMarkerIndex } from '@plugin/slides/shared/documentSource/slideMarkerIndex';
import type {
  PresentationInspectionRequest,
} from '@plugin/slides/shared/presentationInspection';
import type { PresentationInspectionResult } from '../../presentationInspection';
import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import type { SlidesEngineVersionSnapshot } from '../../../engine/types';
import { GeneratedPresentationRenderModelBuilder } from '../../../engine/coordinator/GeneratedPresentationRenderModelBuilder';
import { deckSpecHasSourceSpan } from '../../../engine/coordinator/deckSpecSourceSpans';
import { SpatialAnalyzer } from '../../../engine/quality/SpatialAnalyzer';
import {
  createReadOnlyPresentationImageSourceResolver,
  PresentationImageBindingReader,
} from '../../presentationImageOwnership';
import { createReadOnlyPresentationSvgGraphicAssetResolver } from '../../presentationSvgGraphicOwnership';
import { buildToolFeedbackPayloadAsync } from '../../../tools/inspectFeedback/feedbackPayload';
import {
  PresentationInspectionRuntime,
  buildSourceLocationMap,
} from '../../presentationInspection';
import {
  PresentationScreenshotRuntime,
  type PresentationScreenshotRequest,
  type PresentationScreenshotResult,
} from '../../presentationScreenshot';
import type { SlidesCliExecutionPort } from '../definitions/slidesCli';
import { SlidesCliError, SlidesCliExitCode } from '../definitions/slidesCli';
import {
  readPresentationBuildFailureCode,
  type PresentationBuildFailureCode,
} from '../../presentationBuildFailure';
import {
  StandalonePresentationSnapshotReader,
  type StandalonePresentationSnapshot,
} from '../infrastructure/StandalonePresentationSnapshotReader';

export class StandaloneSlidesCliExecutionRuntime implements SlidesCliExecutionPort {
  private readonly snapshotReader: StandalonePresentationSnapshotReader;
  private readonly renderModelBuilder: GeneratedPresentationRenderModelBuilder;
  private readonly spatialAnalyzer = new SpatialAnalyzer();
  private readonly screenshotRuntime: PresentationScreenshotRuntime;

  constructor(db: Database) {
    this.snapshotReader = new StandalonePresentationSnapshotReader(db);
    this.renderModelBuilder = new GeneratedPresentationRenderModelBuilder(
      createReadOnlyPresentationImageSourceResolver({
        bindingReader: new PresentationImageBindingReader(db),
        documentImageAssets: createDocumentImageAssetRuntime(db),
      }),
      createReadOnlyPresentationSvgGraphicAssetResolver({
        documentSvgAssets: createDocumentSvgAssetRuntime(db),
      }),
    );
    this.screenshotRuntime = new PresentationScreenshotRuntime({
      loadSource: async presentationId => {
        const snapshot = await this.loadRenderModelSnapshot(presentationId);
        return {
          identity: {
            presentationId,
            title: snapshot.version.title,
            versionId: snapshot.version.id,
            versionNumber: snapshot.version.versionNumber,
            sourceKind: snapshot.version.sourceKind,
          },
          renderModel: snapshot.renderModel,
          sourcePackageBytes: snapshot.version.pptxBuffer,
        };
      },
    });
  }

  renderScreenshots(
    request: PresentationScreenshotRequest,
    options?: { readonly signal?: AbortSignal }
  ): Promise<PresentationScreenshotResult> {
    return this.screenshotRuntime.render(request, options);
  }

  async inspectPresentation(
    request: PresentationInspectionRequest
  ): Promise<PresentationInspectionResult> {
    const snapshot = await this.requireSnapshot(request.presentationId, 'inspect');
    const renderModel = await this.buildRenderModel(snapshot);
    const inspectionRuntime = new PresentationInspectionRuntime({
      loadSnapshot: async () => ({
        versionId: snapshot.document.currentRevisionId,
        renderModel,
      }),
      loadSourceLocations: async () =>
        buildSourceLocationMap({
          slides: SlideMarkerIndex.build(snapshot.document.deckSource).listSlides(),
        }),
      buildFeedback: async (
        presentationId,
        versionId,
        selectedRenderModel,
        editableTargetsBySlide,
        options
      ) =>
        buildToolFeedbackPayloadAsync(
          presentationId,
          versionId,
          selectedRenderModel,
          editableTargetsBySlide,
          {
            includeHeuristics: options.includeHeuristics,
            sourceSpanUseCounts: options.sourceSpanUseCounts,
            ...(options.sourceLocations ? { sourceLocations: options.sourceLocations } : {}),
            spatialAnalyzer: {
              analyzeSpatial: async ({ slideNodes }) =>
                this.spatialAnalyzer.analyze([...slideNodes]),
            },
          }
        ),
    });
    return inspectionRuntime.inspect(request);
  }

  private async loadRenderModelSnapshot(presentationId: string): Promise<{
    readonly version: SlidesEngineVersionSnapshot;
    readonly renderModel: PresentationRenderModel;
  }> {
    const snapshot = await this.requireSnapshot(presentationId, 'render model');
    const version = toEngineVersion(snapshot);
    return {
      version,
      renderModel: await this.buildRenderModel(snapshot),
    };
  }

  private async buildRenderModel(
    snapshot: StandalonePresentationSnapshot
  ): Promise<PresentationRenderModel> {
    const version = toEngineVersion(snapshot);
    return this.renderModelBuilder.build(
      snapshot.document.nodeId,
      version,
      {
        assetContext: {
          documentId: snapshot.document.nodeId,
          ...(snapshot.projectId ? { projectId: snapshot.projectId } : {}),
        },
      },
      { canEditSourceSelection: deckSpecHasSourceSpan(snapshot.document.deckSpec) }
    );
  }

  private async requireSnapshot(
    presentationId: string,
    operation: string
  ): Promise<StandalonePresentationSnapshot> {
    const snapshot = this.snapshotReader.read(presentationId);
    if (!snapshot) {
      throw new SlidesCliError(
        'slides.cli.presentation_unavailable',
        SlidesCliExitCode.PRESENTATION_UNAVAILABLE,
        'Presentation could not be found.'
      );
    }
    if (snapshot.hasCurrentDraft) {
      const buildFailureCode = normalizeDraftFailureCode(
        snapshot.currentDraft?.lastErrorKind ?? null
      );
      throw new SlidesCliError(
        'slides.cli.unresolved_draft',
        SlidesCliExitCode.PRESENTATION_UNAVAILABLE,
        `${operation} refused the old compiled checkpoint because this deck has an unresolved deck.js draft; build_failure_code=${buildFailureCode}. Use read_file to inspect the pending source, then edit_file or write_file according to that failure.`
      );
    }
    return snapshot;
  }
}

function normalizeDraftFailureCode(value: string | null): PresentationBuildFailureCode {
  const current = readPresentationBuildFailureCode(value);
  if (current) return current;
  switch (value) {
    case 'typecheck':
      return 'slides.codegen.typecheck';
    case 'sandbox':
      return 'slides.codegen.sandbox';
    case 'compose_parse':
      return 'slides.codegen.compose_contract';
    case 'assemble':
      return 'slides.materialization.pptx_failed';
    case 'count_mismatch':
      return 'slides.codegen.slide_count_mismatch';
    default:
      return 'slides.codegen.unknown';
  }
}

function toEngineVersion(snapshot: StandalonePresentationSnapshot): SlidesEngineVersionSnapshot {
  const { document } = snapshot;
  return {
    id: document.currentRevisionId,
    nodeId: document.nodeId,
    versionNumber: document.currentRevision,
    deckSpec: document.deckSpec,
    pptxBuffer: document.pptxBuffer,
    sourceKind: 'generated',
    deckSource: document.deckSource,
    title: document.title,
  };
}

import type {
  DeckAssemblerPort,
  PatchCompilerPort,
  PptxReaderPort,
  SlidesEngineAssembleDeckRequest,
  SlidesEngineCompilePatchRequest,
  SlidesEngineAnalyzeSpatialRequest,
  SlidesEngineExecutionAdapter,
  SlidesEngineExecutionContext,
  SlidesEngineLogger,
  SlidesEngineParsePptxRequest,
  SlidesEngineResolvePatchImageSourceRequest,
  SlidesPresentationQueryPort,
  SlidesEngineVersionRequest,
} from '../types';
import { SpatialAnalyzer } from '../quality/SpatialAnalyzer';
import { resolveImageAsset } from '../assets/imageAssetResolver';

export interface InProcessSlidesEngineExecutionAdapterDeps {
  readonly deckAssembler: DeckAssemblerPort;
  readonly patchCompiler: PatchCompilerPort;
  readonly pptxReader: PptxReaderPort;
  readonly presentationQueries: SlidesPresentationQueryPort;
  readonly logger?: SlidesEngineLogger;
}

const noopLogger: SlidesEngineLogger = {
  info() {},
  warn() {},
};

export class InProcessSlidesEngineExecutionAdapter implements SlidesEngineExecutionAdapter {
  private readonly deckAssembler: DeckAssemblerPort;
  private readonly patchCompiler: PatchCompilerPort;
  private readonly pptxReader: PptxReaderPort;
  private readonly presentationQueries: SlidesPresentationQueryPort;
  private readonly logger: SlidesEngineLogger;

  constructor(deps: InProcessSlidesEngineExecutionAdapterDeps) {
    this.deckAssembler = deps.deckAssembler;
    this.patchCompiler = deps.patchCompiler;
    this.pptxReader = deps.pptxReader;
    this.presentationQueries = deps.presentationQueries;
    this.logger = deps.logger ?? noopLogger;
  }

  async assembleDeck(request: SlidesEngineAssembleDeckRequest): Promise<Buffer> {
    return await this.runWithTelemetry(request.context, async () =>
      request.assembleOptions
        ? this.deckAssembler.assemble(request.deckSpec, request.assembleOptions)
        : this.deckAssembler.assemble(request.deckSpec)
    );
  }

  async parsePptx(request: SlidesEngineParsePptxRequest) {
    return await this.runWithTelemetry(request.context, async () =>
      this.pptxReader.parse(request.buffer)
    );
  }

  async compilePatch(request: SlidesEngineCompilePatchRequest): Promise<Buffer> {
    return await this.runWithTelemetry(request.context, async () =>
      this.patchCompiler.compile(request.sourcePptxBuffer, request.patchSpec)
    );
  }

  async analyzeSpatial(request: SlidesEngineAnalyzeSpatialRequest) {
    return await this.runWithTelemetry(request.context, async () =>
      new SpatialAnalyzer().analyze([...request.slideNodes])
    );
  }

  async resolvePatchImageSource(
    request: SlidesEngineResolvePatchImageSourceRequest
  ): Promise<string> {
    return await this.runWithTelemetry(request.context, async () => {
      const asset = resolveImageAsset(request.source);
      switch (asset.kind) {
        case 'data_uri':
          return asset.dataUri;
        case 'local_file':
          return asset.path;
      }
    });
  }

  async inspectPresentation(request: SlidesEngineVersionRequest) {
    return await this.runWithTelemetry(request.context, async () =>
      this.presentationQueries.inspect(request.version, request.assembleOptions)
    );
  }

  async exportPresentation(request: SlidesEngineVersionRequest) {
    return await this.runWithTelemetry(request.context, async () =>
      this.presentationQueries.export(request.version, request.assembleOptions)
    );
  }

  async buildPreview(request: SlidesEngineVersionRequest) {
    return await this.runWithTelemetry(request.context, async () =>
      this.presentationQueries.getPreview(request.nodeId, request.version, request.assembleOptions)
    );
  }

  async buildRenderModel(request: SlidesEngineVersionRequest) {
    return await this.runWithTelemetry(request.context, async () =>
      this.presentationQueries.getRenderModel(
        request.nodeId,
        request.version,
        request.assembleOptions,
        request.renderModelOptions
      )
    );
  }

  private async runWithTelemetry<T>(
    context: SlidesEngineExecutionContext,
    operation: () => Promise<T>
  ): Promise<T> {
    const startedAt = Date.now();
    this.logger.info('slides_engine.operation.start', {
      operation: context.operation,
      jobId: context.jobId,
      traceId: context.traceId,
      nodeId: context.nodeId,
      versionId: context.versionId,
      projectId: context.projectId,
    });

    try {
      const result = await operation();
      this.logger.info('slides_engine.operation.success', {
        operation: context.operation,
        jobId: context.jobId,
        traceId: context.traceId,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      this.logger.warn('slides_engine.operation.failed', {
        operation: context.operation,
        jobId: context.jobId,
        traceId: context.traceId,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

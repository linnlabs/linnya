import { randomUUID } from 'node:crypto';
import { MathFormulaError, SlideMarkerIndex, type DeckSpec } from '@plugin/slides/shared';
import {
  createSlidesEngineExecutionContext,
  SvgGraphicMaterializationError,
  type DeckAssembleOptions,
  type SlidesEngineExecutionAdapter,
  type SlidesEngineExecutionScope,
} from '@plugin/slides/backend-engine-core';
import type {
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxJsonObject,
} from '@plugin/backend/sandboxRuntime';
import type { PresentationRepositoryPort } from '../persistence';
import type { PresentationSvgGraphicOwnerPort } from '../features/presentationSvgGraphicOwnership';
import {
  PresentationBuildExecutionError,
  PresentationFormulaBuildExecutionError,
  type PresentationComposeExecutionPort,
} from '../features/presentationBuildExecution';
import { PresentationStaleBaseError, PresentationStaleSourceError } from '../persistence';
import {
  createPresentationBuildFailure,
  PresentationBuildFailureError,
  type PresentationBuildFailureCode,
} from '../features/presentationBuildFailure';
import { readPptComposeRawPayload } from '../sandbox';
import {
  buildDeckSpecFromDirectInput,
  readCompiledDirectComposeInput,
  type DirectComposeInput,
} from './compose/presentationComposeInput.js';
import {
  directComposeInputHasSvgGraphic,
  ownSvgGraphicSources,
} from './compose/ownSvgGraphicSources.js';
import {
  buildDeckDesignAnchor,
  serializeDeckDesignAnchor,
} from './compose/flex-layout/index.js';
import type { ParseWarning } from './compose/inputParsers/parseContext.js';
import {
  mapParseWarningsToCodegenDiagnostics,
  mergeCodegenDiagnostics,
  validateLayoutTrace,
  type CodegenDiagnostic,
} from './writeDiagnostics';

export interface CodegenDeckCreateOptions {
  projectId: string;
  parentId?: string;
  authorId?: string;
  conversationId?: string;
}

export interface CodegenWorkspacePresentationPort {
  createPresentationNode?(options: CodegenDeckCreateOptions & { title: string }): Promise<string>;
  deletePresentationNode?(nodeId: string): Promise<void>;
  getPresentationProjectId?(nodeId: string): Promise<string | null>;
}

export interface CodegenDeckBuilderDeps {
  presentationRepo: Pick<
    PresentationRepositoryPort,
    'createPresentation' | 'commitPresentation' | 'getPresentation'
  >;
  engine: Pick<SlidesEngineExecutionAdapter, 'assembleDeck'>;
  sandbox: CodegenSandboxExecutor;
  workspaceService?: CodegenWorkspacePresentationPort;
  failureLogger?: CodegenDeckBuilderFailureLogger;
  svgGraphicOwner?: PresentationSvgGraphicOwnerPort;
  buildExecution: PresentationComposeExecutionPort;
}

export interface CodegenDeckBuilderFailureLogger {
  error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

export interface CodegenSandboxExecutor {
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
}

export interface CodegenDeckBuildInput {
  nodeId: string;
  source: string;
  conversationId?: string;
  expectedBase?: CodegenDeckExpectedBase;
}

export interface CodegenDeckExpectedBase {
  readonly revisionId: string;
  readonly revision: number;
  readonly sourceHash: string;
}

export interface CodegenDeckCreateInput extends CodegenDeckCreateOptions {
  source: string;
}

export interface CodegenDeckBuildResult {
  versionId: string;
  versionNumber: number;
  deckSpec: DeckSpec;
  pptxBuffer: Buffer;
  diagnostics: readonly CodegenDiagnostic[];
  parseWarnings: string[];
}

export interface CodegenDeckCreateResult extends CodegenDeckBuildResult {
  nodeId: string;
}

interface CompiledDeckSource {
  readonly input: DirectComposeInput;
  readonly createSlideCallCount: number;
  readonly diagnostics: readonly CodegenDiagnostic[];
  readonly parseWarnings: string[];
}

const CODEGEN_SOURCE_CAPABILITY_BYTES = 256 * 1024;

export class CodegenDeckBuilder {
  constructor(private readonly deps: CodegenDeckBuilderDeps) {}

  async buildNewPresentation(input: CodegenDeckCreateInput): Promise<CodegenDeckCreateResult> {
    if (!this.deps.workspaceService?.createPresentationNode) {
      failBuild(
        'slides.environment.workspace_unavailable',
        'Workspace service is required to create presentation documents.'
      );
    }

    const source = this.readNonEmptySource(input.source);
    const compiled = await this.compileAuthoringInputFromSource(source);
    let nodeId: string | undefined;

    try {
      try {
        nodeId = await this.deps.workspaceService.createPresentationNode({
          projectId: input.projectId,
          ...(input.parentId ? { parentId: input.parentId } : {}),
          ...(input.authorId ? { authorId: input.authorId } : {}),
          title: compiled.input.title,
        });
      } catch {
        failBuild(
          'slides.environment.workspace_unavailable',
          'Workspace could not create the presentation document.'
        );
      }
      const deckSpec = await this.buildOwnedDeckSpec(compiled, {
        documentId: nodeId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      });
      const pptxBuffer = await this.assembleDeckSpec(
        deckSpec,
        this.buildDeckAssembleOptions(nodeId, input.projectId, input.conversationId),
        { nodeId, projectId: input.projectId }
      );
      let version: Awaited<ReturnType<PresentationRepositoryPort['createPresentation']>>;
      try {
        version = await this.deps.presentationRepo.createPresentation(nodeId, deckSpec, {
          pptxBuffer,
          deckSource: source,
          ...(input.authorId ? { authorId: input.authorId } : {}),
          origin: 'codegen',
        });
      } catch {
        failBuild(
          'slides.persistence.commit_failed',
          'The new presentation revision could not be committed.'
        );
      }

      return {
        nodeId,
        versionId: version.revisionId,
        versionNumber: version.revision,
        deckSpec,
        pptxBuffer,
        diagnostics: compiled.diagnostics,
        parseWarnings: compiled.parseWarnings,
      };
    } catch (error) {
      await this.rollbackCreatedNode(nodeId, error);
      throw error;
    }
  }

  async buildFromSource(input: CodegenDeckBuildInput): Promise<CodegenDeckBuildResult> {
    return this.buildExistingPresentation(input, 'codegen');
  }

  async restoreFromSource(input: CodegenDeckBuildInput): Promise<CodegenDeckBuildResult> {
    return this.buildExistingPresentation(input, 'restore');
  }

  private async buildExistingPresentation(
    input: CodegenDeckBuildInput,
    origin: 'codegen' | 'restore'
  ): Promise<CodegenDeckBuildResult> {
    const source = this.readNonEmptySource(input.source);
    let current: Awaited<ReturnType<PresentationRepositoryPort['getPresentation']>>;
    try {
      current = await this.deps.presentationRepo.getPresentation(input.nodeId);
    } catch {
      failBuild(
        'slides.persistence.commit_failed',
        'The current presentation revision could not be read.'
      );
    }
    if (!current) {
      failBuild('slides.persistence.commit_failed', 'The presentation document no longer exists.');
    }
    const expectedBase = input.expectedBase ?? {
      revisionId: current.currentRevisionId,
      revision: current.currentRevision,
      sourceHash: current.sourceHash,
    };
    this.assertExpectedBase(input.nodeId, expectedBase, current);
    const compiled = await this.compileAuthoringInputFromSource(
      source,
      current.deckSpec.theme
    );
    const deckSpec = await this.buildOwnedDeckSpec(compiled, {
      documentId: input.nodeId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    });
    const pptxBuffer = await this.assembleDeckSpec(
      deckSpec,
      this.buildDeckAssembleOptions(
        input.nodeId,
        await this.resolvePresentationProjectId(input.nodeId),
        input.conversationId
      ),
      { nodeId: input.nodeId }
    );
    let version: Awaited<ReturnType<PresentationRepositoryPort['commitPresentation']>>;
    try {
      version = await this.deps.presentationRepo.commitPresentation(input.nodeId, deckSpec, {
        pptxBuffer,
        deckSource: source,
        baseRevisionId: expectedBase.revisionId,
        baseRevision: expectedBase.revision,
        origin,
      });
    } catch (error) {
      if (
        error instanceof PresentationStaleBaseError ||
        error instanceof PresentationStaleSourceError
      ) {
        throw error;
      }
      failBuild(
        'slides.persistence.commit_failed',
        'The presentation revision could not be committed.'
      );
    }

    return {
      versionId: version.revisionId,
      versionNumber: version.revision,
      deckSpec,
      pptxBuffer,
      diagnostics: compiled.diagnostics,
      parseWarnings: compiled.parseWarnings,
    };
  }

  async buildDeckSpecFromSource(input: CodegenDeckBuildInput): Promise<DeckSpec> {
    let current: Awaited<ReturnType<PresentationRepositoryPort['getPresentation']>>;
    try {
      current = await this.deps.presentationRepo.getPresentation(input.nodeId);
    } catch {
      failBuild(
        'slides.persistence.commit_failed',
        'The current presentation theme could not be read.'
      );
    }
    const compiled = await this.compileAuthoringInputFromSource(
      this.readNonEmptySource(input.source),
      current?.deckSpec.theme
    );
    return this.buildOwnedDeckSpec(compiled, {
      documentId: input.nodeId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    });
  }

  private async compileAuthoringInputFromSource(
    source: string,
    currentTheme?: DeckSpec['theme']
  ): Promise<CompiledDeckSource> {
    let markerIndex: SlideMarkerIndex;
    try {
      markerIndex = SlideMarkerIndex.build(source);
    } catch (error) {
      failBuild('slides.codegen.compose_contract', safeSourceFailureSummary(error));
    }
    const sandboxResult = await this.executeSource(source, currentTheme);
    const rawPayload = readPptComposeRawPayload(sandboxResult.value);
    if (!rawPayload) {
      failBuild(
        'slides.codegen.compose_contract',
        'Sandbox result did not contain a compose payload.'
      );
    }

    const compiled = await this.compileComposeInput(rawPayload.rawPayload);
    const diagnostics = mergeCodegenDiagnostics(
      validateLayoutTrace(rawPayload.layoutTrace, markerIndex.listSlides()),
      mapParseWarningsToCodegenDiagnostics(compiled.parseWarnings)
    );
    return {
      input: compiled.input,
      createSlideCallCount: markerIndex.listSlides().length,
      diagnostics,
      parseWarnings: compiled.parseWarningMessages,
    };
  }

  private async buildOwnedDeckSpec(
    compiled: CompiledDeckSource,
    context: { readonly documentId: string; readonly conversationId?: string },
  ): Promise<DeckSpec> {
    let ownedInput = compiled.input;
    if (directComposeInputHasSvgGraphic(compiled.input)) {
      if (!this.deps.svgGraphicOwner) {
        failBuild(
          'slides.svg.store_unavailable',
          'Slides SVG Graphic ownership is unavailable.'
        );
      }
      ownedInput = await ownSvgGraphicSources(
        compiled.input,
        this.deps.svgGraphicOwner,
        context,
      );
    }

    let deckSpec: DeckSpec;
    try {
      deckSpec = buildDeckSpecFromDirectInput(ownedInput);
    } catch (error) {
      if (error instanceof PresentationBuildFailureError) throw error;
      failBuild('slides.codegen.compose_contract', safeSourceFailureSummary(error));
    }
    this.assertCreateSlideCountMatchesDeck(
      compiled.createSlideCallCount,
      deckSpec.slides.length,
    );
    return deckSpec;
  }

  private buildDeckAssembleOptions(
    documentId: string,
    projectId: string | null,
    conversationId?: string
  ): DeckAssembleOptions {
    return {
      assetContext: {
        documentId,
        ...(projectId ? { projectId } : {}),
        ...(conversationId ? { conversationId } : {}),
      },
    };
  }

  private async resolvePresentationProjectId(nodeId: string): Promise<string | null> {
    try {
      return (await this.deps.workspaceService?.getPresentationProjectId?.(nodeId)) ?? null;
    } catch {
      failBuild(
        'slides.environment.workspace_unavailable',
        'Workspace could not resolve the presentation project.'
      );
    }
  }

  private async assembleDeckSpec(
    deckSpec: DeckSpec,
    assembleOptions?: DeckAssembleOptions,
    scope: SlidesEngineExecutionScope = {}
  ): Promise<Buffer> {
    try {
      return await this.deps.engine.assembleDeck({
        deckSpec,
        assembleOptions,
        context: createSlidesEngineExecutionContext('assembleDeck', scope),
      });
    } catch (error) {
      if (error instanceof PresentationBuildFailureError) throw error;
      if (error instanceof MathFormulaError) {
        failBuild(error.code, error.message);
      }
      if (error instanceof PresentationFormulaBuildExecutionError) {
        failBuild(error.formulaCode, error.message);
      }
      if (error instanceof PresentationBuildExecutionError && error.kind === 'contract') {
        failBuild('slides.materialization.contract_invalid', error.message);
      }
      if (error instanceof SvgGraphicMaterializationError) {
        failBuild(error.code, error.message);
      }
      const referenceId = randomUUID();
      this.deps.failureLogger?.error('[materialization] PPTX assembly failed', {
        referenceId,
        code: 'slides.materialization.pptx_failed',
        presentationId: scope.nodeId ?? null,
        projectId: scope.projectId ?? null,
        title: deckSpec.title,
        slideCount: deckSpec.slides.length,
        layout: deckSpec.layout ?? '16x9',
        error: projectInternalError(error),
      });
      failBuild(
        'slides.materialization.pptx_failed',
        'Slides could not materialize the compiled deck as a PPTX package.',
        referenceId
      );
    }
  }

  private readNonEmptySource(source: string): string {
    if (source.trim().length === 0) {
      failBuild('slides.codegen.compose_contract', 'deck.js source must be non-empty.');
    }
    return source;
  }

  private assertExpectedBase(
    nodeId: string,
    expected: CodegenDeckExpectedBase,
    current: Awaited<ReturnType<PresentationRepositoryPort['getPresentation']>>
  ): void {
    if (!current) {
      failBuild('slides.persistence.commit_failed', 'The presentation document no longer exists.');
    }
    if (
      current.currentRevisionId !== expected.revisionId ||
      current.currentRevision !== expected.revision
    ) {
      throw new PresentationStaleBaseError(
        nodeId,
        expected.revisionId,
        expected.revision,
        current.currentRevisionId,
        current.currentRevision
      );
    }
    if (current.sourceHash !== expected.sourceHash) {
      throw new PresentationStaleSourceError(nodeId, expected.sourceHash, current.sourceHash);
    }
  }

  private async executeSource(
    source: string,
    currentTheme?: DeckSpec['theme']
  ): Promise<SandboxExecutionResult> {
    const designAnchor = currentTheme
      ? serializeDeckDesignAnchor(buildDeckDesignAnchor(currentTheme))
      : undefined;
    let result: SandboxExecutionResult;
    try {
      result = await this.deps.sandbox.execute({
        profileId: 'ppt_compose',
        language: 'javascript',
        source,
        profileMode: 'codegen-source',
        ...(designAnchor ? { inputs: { DECK_DESIGN: designAnchor } } : {}),
        capabilities: [
          {
            name: 'host.compose',
            maxBytes: CODEGEN_SOURCE_CAPABILITY_BYTES,
          },
        ],
      });
    } catch {
      failBuild(
        'slides.environment.sandbox_unavailable',
        'The deck.js sandbox runner is unavailable.'
      );
    }

    if (!result.success) {
      const errorType = result.error?.type;
      if (errorType === 'transport') {
        failBuild(
          'slides.environment.sandbox_unavailable',
          'The deck.js sandbox runner transport failed.'
        );
      }
      failBuild(
        'slides.codegen.sandbox',
        result.error?.message?.trim() || 'Sandbox execution failed without an error summary.'
      );
    }

    return result;
  }

  private async compileComposeInput(rawPayload: SandboxJsonObject): Promise<{
    input: DirectComposeInput;
    parseWarnings: readonly ParseWarning[];
    parseWarningMessages: string[];
  }> {
    let compiled: Awaited<
      ReturnType<PresentationComposeExecutionPort['compileComposePayload']>
    >;
    try {
      compiled = await this.deps.buildExecution.compileComposePayload(rawPayload);
    } catch (error) {
      failBuildExecution(error);
    }
    if (!compiled.ok) {
      if (compiled.kind === 'layout_unavailable') {
        failBuild('slides.environment.build_executor_unavailable', compiled.message);
      }
      failBuild(
        'slides.codegen.compose_contract',
        compiled.message,
      );
    }

    const direct = readCompiledDirectComposeInput(compiled.input);
    if (direct.error || !direct.input) {
      failBuild(
        'slides.environment.build_executor_unavailable',
        'The Slides build executor returned an invalid compose result.',
      );
    }
    return {
      input: direct.input,
      parseWarnings: direct.parseWarningsStructured ?? [],
      parseWarningMessages: direct.parseWarnings ?? [],
    };
  }

  private assertCreateSlideCountMatchesDeck(
    createSlideCallCount: number,
    slideCount: number
  ): void {
    if (createSlideCallCount !== slideCount) {
      failBuild(
        'slides.codegen.slide_count_mismatch',
        `Top-level createSlide() call count ${createSlideCallCount} does not match composed slide count ${slideCount}.`
      );
    }
  }

  private async rollbackCreatedNode(nodeId: string | undefined, error: unknown): Promise<void> {
    if (!nodeId || !this.deps.workspaceService?.deletePresentationNode) {
      return;
    }

    try {
      await this.deps.workspaceService.deletePresentationNode(nodeId);
    } catch {
      failBuild(
        'slides.environment.workspace_unavailable',
        `The presentation build failed and Workspace could not roll back the created document; original failure: ${safeFailureCode(error)}.`
      );
    }
  }
}

function failBuild(
  code: PresentationBuildFailureCode,
  summary: string,
  referenceId?: string
): never {
  throw new PresentationBuildFailureError(createPresentationBuildFailure({
    code,
    summary,
    ...(referenceId ? { referenceId } : {}),
  }));
}

function failBuildExecution(error: unknown): never {
  if (error instanceof PresentationBuildExecutionError && error.kind === 'busy') {
    failBuild(
      'slides.environment.build_executor_busy',
      'Slides build execution capacity is currently full.',
    );
  }
  failBuild(
    'slides.environment.build_executor_unavailable',
    'The Slides build executor is unavailable.',
  );
}

function projectInternalError(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) {
    return { type: typeof error, value: String(error) };
  }
  const cause = Reflect.get(error, 'cause');
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(cause instanceof Error
      ? {
          cause: {
            name: cause.name,
            message: cause.message,
            ...(cause.stack ? { stack: cause.stack } : {}),
          },
        }
      : {}),
  };
}

function safeSourceFailureSummary(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'The deck.js compose contract is invalid.';
}

function safeFailureCode(error: unknown): string {
  return error instanceof PresentationBuildFailureError
    ? error.failure.code
    : 'slides.codegen.unknown';
}

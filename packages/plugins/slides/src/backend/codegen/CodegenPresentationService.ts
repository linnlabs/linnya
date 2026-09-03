import type { PresentationDraftRecord, PresentationDocumentRecord } from '../persistence';
import {
  PresentationDraftStaleBaseError,
  PresentationStaleBaseError,
  PresentationStaleSourceError,
  toSlidesDraftStatus,
} from '../persistence';
import { DeckSourceStore, DeckSourceStoreError } from './DeckSourceStore.js';
import { DeckReadStateRegistry } from './DeckReadStateRegistry.js';
import { addLineNumbers, buildStructuredPatch } from './diff/formatPatch.js';
import { CodegenPresentationError } from './CodegenPresentationError.js';
import {
  PresentationBuildExecutionError,
  type PresentationTypecheckExecutionPort,
} from '../features/presentationBuildExecution';
import type {
  CodegenPresentationServiceDeps,
  CodegenPresentationBuilderPort,
  CodegenDraftStatus,
  CodegenToolContext,
  CodegenWriteContext,
  CodegenSourceOrigin,
  PptEditInput,
  PptEditOutput,
  PptGrepInput,
  PptGrepOutput,
  PptReadInput,
  PptReadOutput,
  PptSourceSlicesInput,
  PptSourceSlicesOutput,
  PptStructureInput,
  PptStructureOutput,
  PptWriteInput,
  PptWriteOutput,
} from './CodegenPresentationTypes.js';
import { replaceSource } from './editSourceText.js';
import { grepDeckSource } from './grepDeckSource.js';
import { normalizeCodegenSourceCompatibility } from './normalizeCodegenSourceCompatibility.js';
import {
  normalizeLineEndings,
  buildMergedSourceSpanSnapshot,
  expandDeckSourceSpanForElementEdit,
  readDeckSourceSlice,
  readDeckSourceSpanSlice,
  splitLines,
} from './sourceText.js';
import { structureDeckSource } from './structureDeckSource.js';
import type { CodegenDiagnostic } from './writeDiagnostics';
import {
  createPresentationBuildFailure,
  formatPresentationWriteFailure,
  PresentationBuildFailureError,
  type PresentationBuildFailure,
  type PresentationExpectedRevision,
  type PresentationWriteFailure,
} from '../features/presentationBuildFailure';
import { canCreateInitialDraftForFailure } from './InitialPresentationDraftCreator.js';

export { DeckReadStateRegistry } from './DeckReadStateRegistry.js';
export { CodegenPresentationError } from './CodegenPresentationError.js';
export type {
  CodegenPresentationBuilderPort,
  CodegenInitialDraftCreatorPort,
  CodegenPresentationServiceDeps,
  CodegenToolContext,
  CodegenWriteContext,
  PptEditInput,
  PptEditOutput,
  PptGrepInput,
  PptGrepOutput,
  PptReadInput,
  PptReadOutput,
  PptSourceSliceOutput,
  PptSourceSliceTargetInput,
  PptSourceSlicesInput,
  PptSourceSlicesOutput,
  PptStructureInput,
  PptStructureOutput,
  PptWriteInput,
  PptWriteOutput,
} from './CodegenPresentationTypes.js';

interface CurrentDeckSource {
  document: PresentationDocumentRecord;
  source: string;
  sourceOrigin: CodegenSourceOrigin;
  sourceKey: string;
  draftStatus?: CodegenDraftStatus;
}

export class CodegenPresentationService {
  private readonly sourceStore: DeckSourceStore;
  private readonly readStateRegistry: DeckReadStateRegistry;
  private readonly buildExecution: PresentationTypecheckExecutionPort;

  constructor(private readonly deps: CodegenPresentationServiceDeps) {
    this.sourceStore = new DeckSourceStore(deps.presentationRepo);
    this.readStateRegistry = deps.readStateRegistry ?? new DeckReadStateRegistry();
    this.buildExecution = deps.buildExecution;
  }

  async read(input: PptReadInput, ctx: CodegenToolContext): Promise<PptReadOutput> {
    const current = await this.readCurrentSourceForTool(input.presentation_id);
    const normalizedSource = normalizeLineEndings(current.source);
    const allLines = splitLines(normalizedSource);
    const totalLines = allLines.length;
    const slice = readDeckSourceSlice(normalizedSource, input);
    const content = addLineNumbers(slice.content, slice.startLine);
    const previousEntry = this.readStateRegistry.get(ctx.conversationId, input.presentation_id);
    const isSameRead =
      previousEntry?.sourceKey === current.sourceKey &&
      previousEntry.isPartialView === slice.isPartialView &&
      previousEntry.offset === input.offset &&
      previousEntry.limit === input.limit &&
      previousEntry.slide === input.slide;

    if (isSameRead) {
      return {
        type: 'deck_unchanged',
        file: { presentationId: input.presentation_id, title: current.document.title },
      };
    }

    this.readStateRegistry.set(ctx.conversationId, input.presentation_id, {
      sourceKey: current.sourceKey,
      contentSnapshot: slice.registrySnapshot,
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.slide !== undefined ? { slide: input.slide } : {}),
      isPartialView: slice.isPartialView,
      readAtMs: Date.now(),
    });

    return {
      type: 'text',
      file: {
        presentationId: input.presentation_id,
        title: current.document.title,
        versionId: current.document.currentRevisionId,
        sourceOrigin: current.sourceOrigin,
        sourceKey: current.sourceKey,
        ...(current.draftStatus ? { draftStatus: current.draftStatus } : {}),
        content,
        numLines: slice.numLines,
        startLine: slice.startLine,
        totalLines,
        ...(input.slide !== undefined ? { slide: input.slide } : {}),
      },
    };
  }

  async readSourceSlices(
    input: PptSourceSlicesInput,
    ctx: CodegenToolContext
  ): Promise<PptSourceSlicesOutput> {
    if (input.targets.length === 0) {
      throw new CodegenPresentationError('source slice targets must not be empty.', 1);
    }

    const current = await this.readCurrentSourceForTool(input.presentation_id);
    const normalizedSource = normalizeLineEndings(current.source);
    const allLines = splitLines(normalizedSource);
    const slices = input.targets.map(target => {
      const editSpan = expandDeckSourceSpanForElementEdit(normalizedSource, target.sourceSpan);
      const slice = readDeckSourceSpanSlice(normalizedSource, editSpan);
      return {
        elementId: target.elementId,
        slideNumber: target.slideNumber,
        kind: target.kind,
        sourceSpan: target.sourceSpan,
        startLine: slice.startLine,
        endLine: slice.endLine,
        numLines: slice.numLines,
        content: slice.content,
      };
    });

    const registrySnapshot = buildMergedSourceSpanSnapshot(
      normalizedSource,
      input.targets.map(target =>
        expandDeckSourceSpanForElementEdit(normalizedSource, target.sourceSpan)
      )
    );
    // UI 点选已经给出了源码定位；这里记录读取历史用于后续去重和排查，但
    // edit_file 本身只依赖当前源码里的精确 old_string，不再把 read-state 当写入授权。
    this.readStateRegistry.set(ctx.conversationId, input.presentation_id, {
      sourceKey: current.sourceKey,
      contentSnapshot: registrySnapshot,
      isPartialView: true,
      readAtMs: Date.now(),
    });

    return {
      presentationId: input.presentation_id,
      title: current.document.title,
      versionId: current.document.currentRevisionId,
      sourceOrigin: current.sourceOrigin,
      sourceKey: current.sourceKey,
      ...(current.draftStatus ? { draftStatus: current.draftStatus } : {}),
      totalLines: allLines.length,
      slices,
    };
  }

  async edit(input: PptEditInput, ctx: CodegenToolContext): Promise<PptEditOutput> {
    if (input.old_string === input.new_string) {
      throw new CodegenPresentationError(
        'No changes to make: old_string and new_string are exactly the same.',
        1
      );
    }

    const current = await this.readCurrentSourceForTool(input.presentation_id);
    const replacement = replaceSource(
      current.source,
      input.old_string,
      input.new_string,
      input.replace_all === true
    );
    const source = normalizeCodegenSourceCompatibility(replacement.source);
    const buildResult = await this.tryPersistCompiledOrDraft({
      nodeId: input.presentation_id,
      source,
      conversationId: ctx.conversationId,
      baseDocument: current.document,
    });
    this.readStateRegistry.invalidateAllForDeck(input.presentation_id);
    this.recordFullRead(
      ctx.conversationId,
      input.presentation_id,
      compiledSourceKey(buildResult.versionId),
      source
    );

    return {
      presentationId: input.presentation_id,
      title: buildResult.deckSpec.title,
      versionId: buildResult.versionId,
      oldString: input.old_string,
      newString: input.new_string,
      originalSource: current.source,
      structuredPatch: buildStructuredPatch(current.source, source),
      replaceAll: input.replace_all === true,
      slideCount: buildResult.deckSpec.slides.length,
      parseWarnings: buildResult.parseWarnings,
      diagnostics: buildResult.diagnostics,
    };
  }

  async write(input: PptWriteInput, ctx: CodegenWriteContext): Promise<PptWriteOutput> {
    if (input.source.trim().length === 0) {
      throw new CodegenPresentationError('source must not be empty.', 1);
    }
    if (/\beditPresentation\s*\(/.test(input.source)) {
      throw new CodegenPresentationError(
        'write_file does not support editPresentation(). Use edit_file to modify an existing deck.',
        2
      );
    }
    const source = normalizeCodegenSourceCompatibility(input.source);

    const presentationId = input.presentation_id?.trim();
    if (!presentationId) {
      let buildResult: Awaited<ReturnType<CodegenPresentationBuilderPort['buildNewPresentation']>>;
      try {
        await this.assertCodegenSourceTypechecks(source);
        buildResult = await this.deps.builder.buildNewPresentation({
          source,
          projectId: ctx.projectId,
          conversationId: ctx.conversationId,
          ...(ctx.parentId ? { parentId: ctx.parentId } : {}),
          ...(ctx.authorId ? { authorId: ctx.authorId } : {}),
        });
      } catch (error) {
        const failure = normalizeBuildFailure(error);
        if (
          this.deps.initialDraftCreator &&
          canCreateInitialDraftForFailure(failure)
        ) {
          try {
            const pending = await this.deps.initialDraftCreator.create({
              source,
              title: ctx.requestedTitle?.trim() || '未命名演示文稿',
              failure,
              projectId: ctx.projectId,
              ...(ctx.parentId ? { parentId: ctx.parentId } : {}),
              ...(ctx.authorId ? { authorId: ctx.authorId } : {}),
              ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
            });
            const draftStatus = toSlidesDraftStatus(pending.draft);
            const buildFailure = buildSavedInitialDraftFailure(
              failure,
              pending.shell.nodeId,
              pending.draft
            );
            this.recordFullRead(
              ctx.conversationId,
              pending.shell.nodeId,
              draftSourceKey(pending.draft),
              source
            );
            return {
              type: 'create',
              buildStatus: 'draft',
              presentationId: pending.shell.nodeId,
              title: pending.shell.deckSpec.title,
              versionId: pending.shell.versionId,
              versionNumber: pending.shell.versionNumber,
              source,
              slideCount: pending.shell.deckSpec.slides.length,
              parseWarnings: [],
              diagnostics: [],
              draftStatus,
              buildFailure,
            };
          } catch (draftCreationError) {
            throw buildCodegenFailureError(draftCreationError, {
              draftSaved: false,
              presentationId: null,
              expectedRevision: null,
            });
          }
        }
        throw buildCodegenFailureError(error, {
          draftSaved: false,
          presentationId: null,
          expectedRevision: null,
        });
      }
      this.recordFullRead(
        ctx.conversationId,
        buildResult.nodeId,
        compiledSourceKey(buildResult.versionId),
        source
      );
      return {
        type: 'create',
        buildStatus: 'ready',
        presentationId: buildResult.nodeId,
        title: buildResult.deckSpec.title,
        versionId: buildResult.versionId,
        versionNumber: buildResult.versionNumber,
        source,
        slideCount: buildResult.deckSpec.slides.length,
        parseWarnings: buildResult.parseWarnings,
        diagnostics: buildResult.diagnostics,
      };
    }

    const current = await this.readCurrentSourceForWrite(presentationId);
    this.assertExpectedSourceKey(presentationId, input.expected_source_key, current.sourceKey);
    let buildResult: Awaited<ReturnType<typeof this.tryPersistCompiledOrDraft>>;
    try {
      buildResult = await this.tryPersistCompiledOrDraft({
        nodeId: presentationId,
        source,
        conversationId: ctx.conversationId,
        baseDocument: current.document,
      });
    } catch (error) {
      const savedDraft = readSavedDraftFailure(error, presentationId, this.deps.draftRepo);
      if (!savedDraft) throw error;

      this.readStateRegistry.invalidateAllForDeck(presentationId);
      this.recordFullRead(
        ctx.conversationId,
        presentationId,
        draftSourceKey(savedDraft.draft),
        source
      );
      return {
        type: 'update',
        buildStatus: 'draft',
        presentationId,
        title: current.document.title,
        versionId: current.document.currentRevisionId,
        versionNumber: current.document.currentRevision,
        source,
        structuredPatch: buildStructuredPatch(current.source, source),
        originalSource: current.source,
        slideCount: current.document.slideCount,
        parseWarnings: [],
        diagnostics: [],
        draftStatus: toSlidesDraftStatus(savedDraft.draft),
        buildFailure: savedDraft.failure,
      };
    }
    this.readStateRegistry.invalidateAllForDeck(presentationId);
    this.recordFullRead(
      ctx.conversationId,
      presentationId,
      compiledSourceKey(buildResult.versionId),
      source
    );
    return {
      type: 'update',
      buildStatus: 'ready',
      presentationId,
      title: buildResult.deckSpec.title,
      versionId: buildResult.versionId,
      versionNumber: buildResult.versionNumber,
      source,
      structuredPatch: buildStructuredPatch(current.source, source),
      originalSource: current.source,
      slideCount: buildResult.deckSpec.slides.length,
      parseWarnings: buildResult.parseWarnings,
      diagnostics: buildResult.diagnostics,
    };
  }

  private async assertCodegenSourceTypechecks(source: string): Promise<void> {
    // Compile-time typecheck of the user-supplied deck.js against the
    // canonical pptComposeProfile.ambient.d.ts. Catches TypeScript syntax in
    // a JS file (TS80xx), undeclared globals like editPresentation (TS2304),
    // and shape mismatches against the layout primitives (TS2769/2345).
    // TypeScript compiler 属于可信 build workload，不属于执行 deck.js 的
    // Profiled Code Sandbox。生产装配必须通过 feature-owned executor 隔离它。
    let typecheck: Awaited<
      ReturnType<PresentationTypecheckExecutionPort['typecheckCodegenSource']>
    >;
    try {
      typecheck = await this.buildExecution.typecheckCodegenSource(source);
    } catch (error) {
      if (error instanceof PresentationBuildExecutionError && error.kind === 'busy') {
        throw new PresentationBuildFailureError(
          createPresentationBuildFailure({
            code: 'slides.environment.build_executor_busy',
            summary: 'Slides build execution capacity is currently full.',
          })
        );
      }
      throw new PresentationBuildFailureError(
        createPresentationBuildFailure({
          code: 'slides.environment.build_executor_unavailable',
          summary: 'The Slides build executor is unavailable.',
        })
      );
    }
    if (!typecheck.ok) {
      throw new PresentationBuildFailureError(
        createPresentationBuildFailure({
          code: 'slides.codegen.typecheck',
          summary: typecheck.message,
          diagnostics: typecheck.records.map(record => ({
            tsCode: record.code,
            line: record.line,
            column: record.column,
            ...(record.snippet ? { snippet: record.snippet } : {}),
          })),
        })
      );
    }
  }

  private assertExpectedSourceKey(
    presentationId: string,
    expectedSourceKey: string | undefined,
    currentSourceKey: string
  ): void {
    if (!expectedSourceKey || expectedSourceKey === currentSourceKey) return;
    this.readStateRegistry.invalidateAllForDeck(presentationId);
    throw new CodegenPresentationError(
      `Slides source changed after edit_file read the current content: expected ${expectedSourceKey}, current ${currentSourceKey}. Use read_file to reload the current deck.js source, then apply the edit again.`,
      9
    );
  }

  async grep(input: PptGrepInput): Promise<PptGrepOutput> {
    const current = await this.readCurrentSourceForTool(input.presentation_id);
    const result = grepDeckSource(input, current.source);

    return {
      presentationId: input.presentation_id,
      title: current.document.title,
      versionId: current.document.currentRevisionId,
      sourceOrigin: current.sourceOrigin,
      sourceKey: current.sourceKey,
      ...(current.draftStatus ? { draftStatus: current.draftStatus } : {}),
      mode: result.mode,
      content: result.content,
      matchCount: result.matchCount,
    };
  }

  async structure(input: PptStructureInput): Promise<PptStructureOutput> {
    const current = await this.readCurrentSourceForTool(input.presentation_id);
    const structure = structureDeckSource(
      input.presentation_id,
      current.document.currentRevisionId,
      current.document.title,
      current.source,
      current.document.deckSpec,
      { elementCountsUnavailable: current.sourceOrigin === 'draft' }
    );
    return {
      ...structure,
      title: current.document.title,
      sourceOrigin: current.sourceOrigin,
      sourceKey: current.sourceKey,
      ...(current.draftStatus ? { draftStatus: current.draftStatus } : {}),
    };
  }

  private recordFullRead(
    conversationId: string,
    presentationId: string,
    sourceKey: string,
    source: string
  ): void {
    this.readStateRegistry.set(conversationId, presentationId, {
      sourceKey,
      contentSnapshot: source,
      isPartialView: false,
      readAtMs: Date.now(),
    });
  }

  private async readCurrentSourceForTool(presentationId: string): Promise<CurrentDeckSource> {
    const { document, source } = await this.requireCodegenReadyForTool(presentationId);
    return this.withDraftIfPresent(document, source);
  }

  private async readCurrentSourceForWrite(presentationId: string): Promise<CurrentDeckSource> {
    const { document, source } = await this.requireCodegenReadyForWrite(presentationId);
    return this.withDraftIfPresent(document, source);
  }

  private withDraftIfPresent(
    document: PresentationDocumentRecord,
    compiledSource: string
  ): CurrentDeckSource {
    const draft = this.deps.draftRepo?.get(document.nodeId) ?? null;
    if (!draft) {
      return {
        document,
        source: compiledSource,
        sourceOrigin: 'compiled',
        sourceKey: compiledSourceKey(document.currentRevisionId),
      };
    }

    return {
      document,
      source: draft.deckSource,
      sourceOrigin: 'draft',
      sourceKey: draftSourceKey(draft),
      draftStatus: buildDraftStatus(draft),
    };
  }

  private async tryPersistCompiledOrDraft(input: {
    nodeId: string;
    source: string;
    conversationId?: string;
    baseDocument: PresentationDocumentRecord;
  }): Promise<{
    versionId: string;
    versionNumber: number;
    deckSpec: PresentationDocumentRecord['deckSpec'];
    pptxBuffer: Buffer;
    diagnostics: readonly CodegenDiagnostic[];
    parseWarnings: string[];
  }> {
    try {
      await this.assertCodegenSourceTypechecks(input.source);
      const buildResult = await this.deps.builder.buildFromSource({
        nodeId: input.nodeId,
        source: input.source,
        conversationId: input.conversationId,
        expectedBase: {
          revisionId: input.baseDocument.currentRevisionId,
          revision: input.baseDocument.currentRevision,
          sourceHash: input.baseDocument.sourceHash,
        },
      });
      this.deps.draftRepo?.delete(input.nodeId);
      return buildResult;
    } catch (error) {
      if (
        error instanceof PresentationStaleBaseError ||
        error instanceof PresentationStaleSourceError
      ) {
        this.readStateRegistry.invalidateAllForDeck(input.nodeId);
        throw buildStaleSourceConflictError(error, input.baseDocument);
      }
      const failure = normalizeBuildFailure(error);
      const draftSaved = this.deps.draftRepo !== undefined;
      if (this.deps.draftRepo) {
        try {
          this.deps.draftRepo.upsert(
            input.nodeId,
            input.source,
            input.baseDocument,
            failure.summary,
            failure.code
          );
        } catch (draftError) {
          if (draftError instanceof PresentationDraftStaleBaseError) {
            this.readStateRegistry.invalidateAllForDeck(input.nodeId);
            throw buildStaleDraftBaseError(draftError, input.baseDocument);
          }
          this.readStateRegistry.invalidateAllForDeck(input.nodeId);
          throw buildCodegenFailureError(
            new PresentationBuildFailureError(
              createPresentationBuildFailure({
                code: 'slides.persistence.draft_failed',
                summary: 'The pending deck.js source could not be saved as a draft.',
              })
            ),
            buildFailureContext(input.nodeId, input.baseDocument, false)
          );
        }
      }
      this.readStateRegistry.invalidateAllForDeck(input.nodeId);
      throw buildCodegenFailureError(
        new PresentationBuildFailureError(failure),
        buildFailureContext(input.nodeId, input.baseDocument, draftSaved)
      );
    }
  }

  private async requireCodegenReadyForTool(presentationId: string): Promise<{
    document: PresentationDocumentRecord;
    source: string;
  }> {
    try {
      return await this.sourceStore.requireCodegenReady(presentationId);
    } catch (error) {
      if (error instanceof DeckSourceStoreError) {
        throw new CodegenPresentationError(
          'Deck source is empty. edit_file requires a committed deck.js source.',
          5
        );
      }
      if (error instanceof Error && error.message === `Presentation not found: ${presentationId}`) {
        throw new CodegenPresentationError(`Deck does not exist: ${presentationId}.`, 4);
      }
      throw error;
    }
  }

  private async requireCodegenReadyForWrite(presentationId: string): Promise<{
    document: PresentationDocumentRecord;
    source: string;
  }> {
    try {
      return await this.sourceStore.requireCodegenReady(presentationId);
    } catch (error) {
      if (error instanceof DeckSourceStoreError) {
        throw new CodegenPresentationError(
          'Deck source is empty. write_file requires a committed deck.js source.',
          5
        );
      }
      if (error instanceof Error && error.message === `Presentation not found: ${presentationId}`) {
        throw new CodegenPresentationError(`Deck does not exist: ${presentationId}.`, 4);
      }
      throw error;
    }
  }
}

function buildStaleSourceConflictError(
  _error: PresentationStaleBaseError | PresentationStaleSourceError,
  baseDocument: PresentationDocumentRecord
): CodegenPresentationError {
  return buildCodegenFailureError(
    new PresentationBuildFailureError(
      createPresentationBuildFailure({
        code: 'slides.conflict.stale_source',
        summary: 'The deck changed after this operation started; the edit was not saved.',
      })
    ),
    buildFailureContext(baseDocument.nodeId, baseDocument, false)
  );
}

function compiledSourceKey(versionId: string): string {
  return `compiled:${versionId}`;
}

function draftSourceKey(draft: PresentationDraftRecord): string {
  return `draft:${draft.sourceHash}`;
}

function buildDraftStatus(draft: PresentationDraftRecord): CodegenDraftStatus {
  return toSlidesDraftStatus(draft);
}

function buildSavedInitialDraftFailure(
  failure: PresentationBuildFailure,
  presentationId: string,
  draft: PresentationDraftRecord
): PresentationWriteFailure {
  return {
    ...failure,
    draftSaved: true,
    presentationId,
    expectedRevision: {
      revisionId: draft.baseRevisionId,
      revision: draft.baseRevision,
    },
  };
}

function readSavedDraftFailure(
  error: unknown,
  presentationId: string,
  draftRepo: CodegenPresentationServiceDeps['draftRepo']
): { readonly failure: PresentationWriteFailure; readonly draft: PresentationDraftRecord } | null {
  if (!(error instanceof CodegenPresentationError)) return null;
  const failure = error.failure;
  if (!failure?.draftSaved || failure.presentationId !== presentationId || !draftRepo) return null;
  const draft = draftRepo.get(presentationId);
  return draft ? { failure, draft } : null;
}

function buildCodegenFailureError(
  error: unknown,
  context: {
    readonly draftSaved: boolean;
    readonly presentationId: string | null;
    readonly expectedRevision: PresentationExpectedRevision | null;
  }
): CodegenPresentationError {
  const failure: PresentationWriteFailure = {
    ...normalizeBuildFailure(error),
    ...context,
  };
  const errorCode = failure.phase === 'conflict' ? 9 : 10;
  return new CodegenPresentationError(formatPresentationWriteFailure(failure), errorCode, failure);
}

function buildStaleDraftBaseError(
  _staleBase: PresentationDraftStaleBaseError,
  baseDocument: PresentationDocumentRecord
): CodegenPresentationError {
  return buildCodegenFailureError(
    new PresentationBuildFailureError(
      createPresentationBuildFailure({
        code: 'slides.conflict.stale_draft_base',
        summary:
          'Draft source was not saved because another operation updated the deck after this edit started.',
      })
    ),
    buildFailureContext(baseDocument.nodeId, baseDocument, false)
  );
}

function normalizeBuildFailure(error: unknown): PresentationBuildFailure {
  if (error instanceof PresentationBuildFailureError) return error.failure;
  return createPresentationBuildFailure({
    code: 'slides.codegen.unknown',
    summary: 'Slides failed without a recognized structured build failure.',
  });
}

function buildFailureContext(
  presentationId: string,
  baseDocument: PresentationDocumentRecord,
  draftSaved: boolean
): {
  readonly draftSaved: boolean;
  readonly presentationId: string;
  readonly expectedRevision: PresentationExpectedRevision;
} {
  return {
    draftSaved,
    presentationId,
    expectedRevision: {
      revisionId: baseDocument.currentRevisionId,
      revision: baseDocument.currentRevision,
    },
  };
}

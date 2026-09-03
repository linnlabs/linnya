import { describe, expect, it, vi } from 'vitest';

import type { DeckSpec } from '@plugin/slides/shared';
import type { CodegenDiagnostic } from '../writeDiagnostics';
import { PresentationDraftStaleBaseError, PresentationStaleBaseError } from '../../persistence';
import type {
  PresentationDraftRecord,
  PresentationDraftRepositoryPort,
  PresentationDocumentRecord,
  PresentationRepositoryPort,
} from '../../persistence';
import {
  CodegenPresentationError,
  CodegenPresentationService,
  DeckReadStateRegistry,
  type CodegenPresentationBuilderPort,
} from '../CodegenPresentationService.js';
import {
  createPresentationBuildFailure,
  PresentationBuildFailureError,
} from '../../features/presentationBuildFailure';
import {
  createInProcessPresentationBuildExecution,
  PresentationBuildExecutionError,
  type PresentationTypecheckExecutionPort,
} from '../../features/presentationBuildExecution';

const SOURCE = [
  '// === SLIDE 1: cover ===',
  'const cover = createSlide();',
  'createText({ content: "Old title" });',
  '// === END SLIDE 1 ===',
  '// === SLIDE 2: detail ===',
  'const detail = createSlide();',
  'createText({ content: "Detail" });',
  '// === END SLIDE 2 ===',
  'compose({ title: "Deck", slides: [cover, detail] });',
].join('\n');

const DECK_SPEC: DeckSpec = {
  title: 'Deck',
  layout: '16x9',
  slides: [
    {
      slideNumber: 1,
      spec: {
        type: 'freeform',
        elements: [{ type: 'text', content: 'Old title', position: { x: 0, y: 0, w: 1, h: 1 } }],
      },
    },
    {
      slideNumber: 2,
      spec: {
        type: 'freeform',
        elements: [{ type: 'text', content: 'Detail', position: { x: 0, y: 0, w: 1, h: 1 } }],
      },
    },
  ],
};

const EXPECTED_BASE = {
  revisionId: 'version-1',
  revision: 1,
  sourceHash: 'source-hash-1',
} as const;

function makeDocument(
  overrides: Partial<PresentationDocumentRecord> = {}
): PresentationDocumentRecord {
  return {
    nodeId: 'deck-1',
    currentRevisionId: 'version-1',
    currentRevision: 1,
    deckSpec: DECK_SPEC,
    deckSource: SOURCE,
    sourceHash: 'source-hash-1',
    pptxBuffer: Buffer.from('pptx-1'),
    title: 'Deck',
    slideCount: 2,
    layout: '16x9',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<PresentationDraftRecord> = {}): PresentationDraftRecord {
  return {
    nodeId: 'deck-1',
    deckSource: SOURCE.replace('Old title', 'Draft title'),
    sourceHash: 'draft-hash-1',
    baseRevisionId: 'version-1',
    baseRevision: 1,
    lastErrorSummary: 'Sandbox execution failed',
    lastErrorKind: 'sandbox',
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

function makeHarness(
  options: {
    document?: PresentationDocumentRecord | null;
    draft?: PresentationDraftRecord | null;
    buildFromSourceError?: Error;
    draftUpsertError?: Error;
    diagnostics?: readonly CodegenDiagnostic[];
    parseWarnings?: string[];
    enableInitialDraftCreator?: boolean;
    buildExecution?: PresentationTypecheckExecutionPort;
  } = {}
) {
  const currentDocument = options.document === undefined ? makeDocument() : options.document;
  let currentDraft = options.draft === undefined ? null : options.draft;
  const getPresentation = vi.fn(async (_nodeId: string) => currentDocument);
  const buildFromSource = vi.fn(async (_input: { nodeId: string; source: string }) => {
    if (options.buildFromSourceError) {
      throw options.buildFromSourceError;
    }
    return {
      versionId: 'version-2',
      versionNumber: 2,
      deckSpec: DECK_SPEC,
      pptxBuffer: Buffer.from('pptx'),
      diagnostics: options.diagnostics ?? [],
      parseWarnings: options.parseWarnings ?? [],
    };
  });
  const buildNewPresentation = vi.fn(async (_input: { source: string; projectId: string }) => ({
    nodeId: 'deck-new',
    versionId: 'version-new',
    versionNumber: 1,
    deckSpec: DECK_SPEC,
    pptxBuffer: Buffer.from('pptx'),
    diagnostics: options.diagnostics ?? [],
    parseWarnings: options.parseWarnings ?? [],
  }));
  const presentationRepo: Pick<PresentationRepositoryPort, 'getPresentation'> = {
    getPresentation,
  };
  const builder: CodegenPresentationBuilderPort = {
    buildFromSource,
    buildNewPresentation,
  };
  const draftRepo: PresentationDraftRepositoryPort = {
    upsert: vi.fn((nodeId, source, baseDocument, errorSummary, errorKind) => {
      if (options.draftUpsertError) {
        throw options.draftUpsertError;
      }
      currentDraft = {
        nodeId,
        deckSource: source.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
        sourceHash: `draft-hash-${source.length}`,
        baseRevisionId: baseDocument.currentRevisionId,
        baseRevision: baseDocument.currentRevision,
        lastErrorSummary: errorSummary,
        lastErrorKind: errorKind,
        createdAt: 100,
        updatedAt: 300,
      };
      return currentDraft;
    }),
    get: vi.fn((_nodeId: string) => currentDraft),
    has: vi.fn((_nodeId: string) => currentDraft !== null),
    delete: vi.fn((_nodeId: string) => {
      currentDraft = null;
    }),
  };
  const registry = new DeckReadStateRegistry();
  const initialDraftCreator = {
    create: vi.fn(async () => ({
      shell: await buildNewPresentation({ source: SOURCE, projectId: 'project-1' }),
      draft: makeDraft({
        nodeId: 'deck-new',
        deckSource: 'interface Broken { x: number; }',
        baseRevisionId: 'version-new',
        baseRevision: 1,
        lastErrorKind: 'slides.codegen.typecheck',
      }),
    })),
  };
  const service = new CodegenPresentationService({
    presentationRepo,
    builder,
    draftRepo,
    ...(options.enableInitialDraftCreator ? { initialDraftCreator } : {}),
    readStateRegistry: registry,
    buildExecution:
      options.buildExecution ?? createInProcessPresentationBuildExecution(),
  });
  return {
    service,
    registry,
    getPresentation,
    buildFromSource,
    buildNewPresentation,
    draftRepo,
    initialDraftCreator,
  };
}

describe('CodegenPresentationService', () => {
  it('keeps edit and write validation errors aligned with the P1 contract', async () => {
    const emptySourceHarness = makeHarness({
      document: makeDocument({ deckSource: '' }),
    });
    const missingHarness = makeHarness({ document: null });
    const harness = makeHarness();

    await expect(
      harness.service.edit(
        {
          presentation_id: 'deck-1',
          old_string: 'Same',
          new_string: 'Same',
        },
        { conversationId: 'conv-1' }
      )
    ).rejects.toEqual(
      new CodegenPresentationError(
        'No changes to make: old_string and new_string are exactly the same.',
        1
      )
    );

    await expect(
      harness.service.write({ source: '   ' }, { conversationId: 'conv-1', projectId: 'project-1' })
    ).rejects.toEqual(new CodegenPresentationError('source must not be empty.', 1));

    await expect(
      harness.service.write(
        { source: 'editPresentation({});' },
        { conversationId: 'conv-1', projectId: 'project-1' }
      )
    ).rejects.toEqual(
      new CodegenPresentationError(
        'write_file does not support editPresentation(). Use edit_file to modify an existing deck.',
        2
      )
    );

    await expect(
      missingHarness.service.read({ presentation_id: 'missing-deck' }, { conversationId: 'conv-1' })
    ).rejects.toEqual(new CodegenPresentationError('Deck does not exist: missing-deck.', 4));

    await expect(
      emptySourceHarness.service.write(
        { presentation_id: 'deck-1', source: SOURCE },
        { conversationId: 'conv-1', projectId: 'project-1' }
      )
    ).rejects.toEqual(
      new CodegenPresentationError(
        'Deck source is empty. write_file requires a committed deck.js source.',
        5
      )
    );
  });

  describe('write — codegen-source typecheck (errorCode=10)', () => {
    it('把 build executor 饱和投影为可重试环境失败，且不进入 builder', async () => {
      const harness = makeHarness({
        buildExecution: {
          async typecheckCodegenSource() {
            throw new PresentationBuildExecutionError('busy', 'capacity full');
          },
        },
      });

      await expect(harness.service.write(
        { source: SOURCE },
        { conversationId: 'conv-1', projectId: 'project-1' },
      )).rejects.toMatchObject({
        failure: {
          code: 'slides.environment.build_executor_busy',
          retryable: true,
          sourceFixable: false,
          draftSaved: false,
        },
      });
      expect(harness.buildNewPresentation).not.toHaveBeenCalled();
    });

    it('已有稿件的 build Worker 故障保存同一 source draft，不诱导改稿', async () => {
      const harness = makeHarness({
        buildExecution: {
          async typecheckCodegenSource() {
            throw new PresentationBuildExecutionError('unavailable', 'worker crashed');
          },
        },
      });

      const result = await harness.service.write(
        { presentation_id: 'deck-1', source: SOURCE.replace('Old title', 'New title') },
        { conversationId: 'conv-1', projectId: 'project-1' },
      );
      expect(result).toMatchObject({
        buildStatus: 'draft',
        buildFailure: {
          code: 'slides.environment.build_executor_unavailable',
          retryable: true,
          sourceFixable: false,
          draftSaved: true,
        },
      });
      expect(harness.buildFromSource).not.toHaveBeenCalled();
    });

    it('rejects TypeScript variable annotations in deck.js (TS8010) and never reaches buildNewPresentation', async () => {
      const harness = makeHarness();

      await expect(
        harness.service.write(
          { source: 'let x: number = 5;\ncompose({ title: "x", slides: [] });' },
          { conversationId: 'conv-1', projectId: 'project-1' }
        )
      ).rejects.toMatchObject({
        name: 'CodegenPresentationError',
        errorCode: 10,
      });
      expect(harness.buildNewPresentation).not.toHaveBeenCalled();
      expect(harness.buildFromSource).not.toHaveBeenCalled();
    });

    it('errorCode=10 message is the canonical "Sandbox compile error: ..." string with line/col + TS code + deck.js hint', async () => {
      const harness = makeHarness();
      let captured: CodegenPresentationError | undefined;
      try {
        await harness.service.write(
          { source: 'let x: number = 5;' },
          { conversationId: 'conv-1', projectId: 'project-1' }
        );
      } catch (err) {
        captured = err as CodegenPresentationError;
      }
      expect(captured).toBeInstanceOf(CodegenPresentationError);
      expect(captured!.errorCode).toBe(10);
      expect(captured!.message).toMatch(/^\[slides\.codegen\.typecheck\] Sandbox compile error: /);
      expect(captured!.message).toContain('TS8010');
      expect(captured!.message).toContain('line 1, col');
      expect(captured!.message).toContain('deck.js must be plain JavaScript');
    });

    it('saves interface declarations (TS8006) as an unresolved update draft and never re-builds the deck', async () => {
      const harness = makeHarness();

      await harness.service.read({ presentation_id: 'deck-1' }, { conversationId: 'conv-1' });

      const result = await harness.service.write(
        { presentation_id: 'deck-1', source: 'interface Foo { x: number; }' },
        { conversationId: 'conv-1', projectId: 'project-1' }
      );
      expect(result).toMatchObject({
        buildStatus: 'draft',
        buildFailure: { code: 'slides.codegen.typecheck' },
      });
      expect(harness.buildFromSource).not.toHaveBeenCalled();
    });

    it('typecheck runs AFTER the editPresentation guard (errorCode=2 still wins for editPresentation in write_file)', async () => {
      // Deliberately also has a TS annotation; the editPresentation regex
      // must short-circuit first so AI gets the more specific guidance.
      const harness = makeHarness();
      await expect(
        harness.service.write(
          { source: 'let x: number = 5; editPresentation({});' },
          { conversationId: 'conv-1', projectId: 'project-1' }
        )
      ).rejects.toMatchObject({ errorCode: 2 });
    });

    it('update path reports typecheck diagnostics without requiring a prior read', async () => {
      const harness = makeHarness();

      const result = await harness.service.write(
        { presentation_id: 'deck-1', source: 'let x: number = 5;' },
        { conversationId: 'conv-1', projectId: 'project-1' }
      );
      expect(result).toMatchObject({
        buildStatus: 'draft',
        buildFailure: { code: 'slides.codegen.typecheck' },
      });
      expect(harness.buildFromSource).not.toHaveBeenCalled();
    });

    it('update path reports typecheck diagnostics even when an earlier read is stale', async () => {
      const harness = makeHarness();
      await harness.service.read({ presentation_id: 'deck-1' }, { conversationId: 'conv-1' });
      harness.getPresentation.mockResolvedValue(makeDocument({ currentRevisionId: 'version-3' }));

      const result = await harness.service.write(
        { presentation_id: 'deck-1', source: 'let x: number = 5;' },
        { conversationId: 'conv-1', projectId: 'project-1' }
      );
      expect(result).toMatchObject({
        buildStatus: 'draft',
        buildFailure: { code: 'slides.codegen.typecheck' },
      });
      expect(harness.buildFromSource).not.toHaveBeenCalled();
    });

    it('rejects undeclared globals (e.g. `console.foo()`-style typos against the layout API)', async () => {
      const harness = makeHarness();
      await expect(
        harness.service.write(
          { source: 'createSlideX();' },
          { conversationId: 'conv-1', projectId: 'project-1' }
        )
      ).rejects.toMatchObject({ errorCode: 10 });
    });

    it('accepts legal deck.js and proceeds to buildNewPresentation (typecheck does not break the happy path)', async () => {
      const harness = makeHarness();
      const legal = `
const slide = createSlide();
slide.add(createText("hello"));
compose({ title: "ok", slides: [slide] });
`;

      const result = await harness.service.write(
        { source: legal },
        { conversationId: 'conv-1', projectId: 'project-1' }
      );

      expect(result.type).toBe('create');
      expect(harness.buildNewPresentation).toHaveBeenCalledTimes(1);
    });

    it('canonicalizes the common scalar radial radius typo before typecheck and persistence', async () => {
      const harness = makeHarness();
      const source = `
const slide = createSlide();
slide.add(createShape({
  fill: {
    type: "radial",
    stops: [
      { color: "#FFFFFF", position: 0 },
      { color: "#000000", position: 1 },
    ],
    radius: 0.5,
  },
}));
compose({ title: "ok", slides: [slide] });
`;

      const result = await harness.service.write(
        { source },
        { conversationId: 'conv-1', projectId: 'project-1' }
      );

      expect(result.source).toContain('radius: { x: 0.5, y: 0.5 }');
      expect(harness.buildNewPresentation).toHaveBeenCalledWith(
        expect.objectContaining({ source: result.source })
      );
    });
  });

  it('reads deck source in cat -n format and records a full read', async () => {
    const harness = makeHarness();

    const result = await harness.service.read(
      { presentation_id: 'deck-1' },
      { conversationId: 'conv-1' }
    );

    expect(result.file.content?.split('\n').slice(0, 3)).toEqual([
      '     1\t// === SLIDE 1: cover ===',
      '     2\tconst cover = createSlide();',
      '     3\tcreateText({ content: "Old title" });',
    ]);
    expect(result.file).toMatchObject({
      presentationId: 'deck-1',
      versionId: 'version-1',
      numLines: 9,
      startLine: 1,
      totalLines: 9,
    });
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'compiled:version-1',
      contentSnapshot: SOURCE,
      isPartialView: false,
    });
  });

  it('reads the pending draft as the current source when one exists', async () => {
    const draft = makeDraft();
    const harness = makeHarness({ draft });

    const result = await harness.service.read(
      { presentation_id: 'deck-1' },
      { conversationId: 'conv-1' }
    );

    expect(result.file).toMatchObject({
      presentationId: 'deck-1',
      versionId: 'version-1',
      sourceOrigin: 'draft',
      sourceKey: 'draft:draft-hash-1',
      draftStatus: {
        baseVersionId: 'version-1',
        baseVersionNumber: 1,
        errorKind: 'sandbox',
        errorSummary: 'Sandbox execution failed',
        updatedAt: 200,
      },
    });
    expect(result.file.content).toContain('Draft title');
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'draft:draft-hash-1',
      contentSnapshot: draft.deckSource,
      isPartialView: false,
    });
  });

  it('reads exact source slices for selected render targets and authorizes scoped edits', async () => {
    const harness = makeHarness();

    const slices = await harness.service.readSourceSlices(
      {
        presentation_id: 'deck-1',
        targets: [
          {
            elementId: 's1-text-1',
            slideNumber: 1,
            kind: 'text',
            sourceSpan: { startLine: 3, endLine: 3 },
          },
          {
            elementId: 's2-text-1',
            slideNumber: 2,
            kind: 'text',
            sourceSpan: { startLine: 7, endLine: 7 },
          },
        ],
      },
      { conversationId: 'conv-1' }
    );

    expect(slices).toMatchObject({
      presentationId: 'deck-1',
      title: 'Deck',
      versionId: 'version-1',
      sourceOrigin: 'compiled',
      sourceKey: 'compiled:version-1',
      totalLines: 9,
      slices: [
        {
          elementId: 's1-text-1',
          slideNumber: 1,
          kind: 'text',
          startLine: 3,
          endLine: 3,
          content: 'createText({ content: "Old title" });',
        },
        {
          elementId: 's2-text-1',
          slideNumber: 2,
          kind: 'text',
          startLine: 7,
          endLine: 7,
          content: 'createText({ content: "Detail" });',
        },
      ],
    });
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'compiled:version-1',
      contentSnapshot: [
        'createText({ content: "Old title" });',
        'createText({ content: "Detail" });',
      ].join('\n\n'),
      isPartialView: true,
    });

    await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'createText({ content: "Detail" });',
        new_string: 'createText({ content: "Detail updated" });',
      },
      { conversationId: 'conv-1' }
    );

    expect(harness.buildFromSource).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conv-1',
      expectedBase: EXPECTED_BASE,
      source: SOURCE.replace(
        'createText({ content: "Detail" });',
        'createText({ content: "Detail updated" });'
      ),
    });
  });

  it('expands selected element source slices to include follow-up property assignments', async () => {
    const source = [
      'const slide = createSlide();',
      'var coverImg = createImage({ kind: "generated_asset", assetId: "img-1" });',
      'coverImg.position = "absolute";',
      'coverImg.left = 1.5; coverImg.top = 0.6;',
      'coverImg.rounding = false;',
      'slide.add(coverImg);',
      'compose({ title: "Deck", slides: [slide] });',
    ].join('\n');
    const harness = makeHarness({
      document: makeDocument({ deckSource: source }),
    });

    const slices = await harness.service.readSourceSlices(
      {
        presentation_id: 'deck-1',
        targets: [
          {
            elementId: 's1-freeform-0',
            slideNumber: 1,
            kind: 'image',
            sourceSpan: { startLine: 2, endLine: 2 },
          },
        ],
      },
      { conversationId: 'conv-1' }
    );

    expect(slices.slices[0]).toMatchObject({
      elementId: 's1-freeform-0',
      startLine: 2,
      endLine: 5,
      content: [
        'var coverImg = createImage({ kind: "generated_asset", assetId: "img-1" });',
        'coverImg.position = "absolute";',
        'coverImg.left = 1.5; coverImg.top = 0.6;',
        'coverImg.rounding = false;',
      ].join('\n'),
    });
    expect(slices.slices[0]?.content).not.toContain('slide.add(coverImg)');
    expect(harness.registry.get('conv-1', 'deck-1')?.contentSnapshot).toContain(
      'coverImg.rounding = false;'
    );

    const editOutput = await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'coverImg.rounding = false;',
        new_string: 'coverImg.rounding = true;',
      },
      { conversationId: 'conv-1' }
    );

    expect(editOutput.oldString).toBe('coverImg.rounding = false;');
    expect(editOutput.newString).toBe('coverImg.rounding = true;');
  });

  it('reads source slices from a pending draft and reports draft status', async () => {
    const draft = makeDraft();
    const harness = makeHarness({ draft });

    const result = await harness.service.readSourceSlices(
      {
        presentation_id: 'deck-1',
        targets: [
          {
            elementId: 's1-text-1',
            slideNumber: 1,
            kind: 'text',
            sourceSpan: { startLine: 3, endLine: 3 },
          },
        ],
      },
      { conversationId: 'conv-1' }
    );

    expect(result).toMatchObject({
      sourceOrigin: 'draft',
      sourceKey: 'draft:draft-hash-1',
      draftStatus: {
        baseVersionId: 'version-1',
        baseVersionNumber: 1,
        errorKind: 'sandbox',
        errorSummary: 'Sandbox execution failed',
        updatedAt: 200,
      },
      slices: [
        {
          content: 'createText({ content: "Draft title" });',
        },
      ],
    });
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'draft:draft-hash-1',
      contentSnapshot: 'createText({ content: "Draft title" });',
      isPartialView: true,
    });
  });

  it('rejects invalid source slice spans before recording read state', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.readSourceSlices(
        {
          presentation_id: 'deck-1',
          targets: [
            {
              elementId: 's1-text-1',
              slideNumber: 1,
              kind: 'text',
              sourceSpan: { startLine: 20, endLine: 20 },
            },
          ],
        },
        { conversationId: 'conv-1' }
      )
    ).rejects.toMatchObject({
      message: 'source span 20-20 is out of range [1, 9]',
      errorCode: 8,
    });
    expect(harness.registry.get('conv-1', 'deck-1')).toBeUndefined();
  });

  it('does not treat a later full read as unchanged after source slices were recorded', async () => {
    const harness = makeHarness();

    await harness.service.readSourceSlices(
      {
        presentation_id: 'deck-1',
        targets: [
          {
            elementId: 's1-text-1',
            slideNumber: 1,
            kind: 'text',
            sourceSpan: { startLine: 3, endLine: 3 },
          },
        ],
      },
      { conversationId: 'conv-1' }
    );

    const result = await harness.service.read(
      { presentation_id: 'deck-1' },
      { conversationId: 'conv-1' }
    );

    expect(result.type).toBe('text');
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'compiled:version-1',
      contentSnapshot: SOURCE,
      isPartialView: false,
    });
  });

  it('edits the current deck source without a prior read', async () => {
    const harness = makeHarness();

    const result = await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Old title',
        new_string: 'New title',
      },
      { conversationId: 'conv-1' }
    );

    expect(result.versionId).toBe('version-2');
    expect(harness.buildFromSource).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conv-1',
      expectedBase: EXPECTED_BASE,
      source: SOURCE.replace('Old title', 'New title'),
    });
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'compiled:version-2',
      contentSnapshot: SOURCE.replace('Old title', 'New title'),
      isPartialView: false,
    });
  });

  it('allows scoped edits from an offset and limit read when old_string is in that slice', async () => {
    const harness = makeHarness();

    await harness.service.read(
      { presentation_id: 'deck-1', offset: 2, limit: 2 },
      { conversationId: 'conv-1' }
    );

    const result = await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Old title',
        new_string: 'New title',
      },
      { conversationId: 'conv-1' }
    );

    expect(result.versionId).toBe('version-2');
    expect(harness.buildFromSource).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conv-1',
      expectedBase: EXPECTED_BASE,
      source: SOURCE.replace('Old title', 'New title'),
    });
  });

  it('edits the current deck source even when the latest partial read did not include old_string', async () => {
    const harness = makeHarness();

    await harness.service.read(
      { presentation_id: 'deck-1', offset: 5, limit: 2 },
      { conversationId: 'conv-1' }
    );

    const result = await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Old title',
        new_string: 'New title',
      },
      { conversationId: 'conv-1' }
    );

    expect(result.versionId).toBe('version-2');
    expect(harness.buildFromSource).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conv-1',
      expectedBase: EXPECTED_BASE,
      source: SOURCE.replace('Old title', 'New title'),
    });
  });

  it('allows replace_all from the current deck source after a partial read', async () => {
    const harness = makeHarness();

    await harness.service.read(
      { presentation_id: 'deck-1', offset: 2, limit: 2 },
      { conversationId: 'conv-1' }
    );

    const result = await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Old title',
        new_string: 'New title',
        replace_all: true,
      },
      { conversationId: 'conv-1' }
    );

    expect(result.replaceAll).toBe(true);
    expect(harness.buildFromSource).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conv-1',
      expectedBase: EXPECTED_BASE,
      source: SOURCE.replace('Old title', 'New title'),
    });
  });

  it('updates read state after edit even if the latest locator read was partial', async () => {
    const harness = makeHarness();

    await harness.service.read({ presentation_id: 'deck-1' }, { conversationId: 'conv-1' });
    await harness.service.read(
      { presentation_id: 'deck-1', offset: 8, limit: 2 },
      { conversationId: 'conv-1' }
    );

    const result = await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Old title',
        new_string: 'New title',
      },
      { conversationId: 'conv-1' }
    );

    expect(result.versionId).toBe('version-2');
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'compiled:version-2',
      contentSnapshot: SOURCE.replace('Old title', 'New title'),
      isPartialView: false,
    });
  });

  it('allows edit after a full read and updates the read state to the saved version', async () => {
    const harness = makeHarness();

    await harness.service.read({ presentation_id: 'deck-1' }, { conversationId: 'conv-1' });
    const result = await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Old title',
        new_string: 'New title',
      },
      { conversationId: 'conv-1' }
    );

    expect(harness.buildFromSource).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conv-1',
      expectedBase: EXPECTED_BASE,
      source: SOURCE.replace('Old title', 'New title'),
    });
    expect(result).toMatchObject({
      presentationId: 'deck-1',
      versionId: 'version-2',
      oldString: 'Old title',
      newString: 'New title',
      replaceAll: false,
      slideCount: 2,
    });
    expect(result.structuredPatch.length).toBeGreaterThan(0);
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'compiled:version-2',
      contentSnapshot: SOURCE.replace('Old title', 'New title'),
      isPartialView: false,
    });
  });

  it('edits the latest deck source even if an earlier read state is stale', async () => {
    const harness = makeHarness();

    await harness.service.read({ presentation_id: 'deck-1' }, { conversationId: 'conv-1' });
    harness.getPresentation.mockResolvedValue(makeDocument({ currentRevisionId: 'version-3' }));

    const result = await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Old title',
        new_string: 'New title',
      },
      { conversationId: 'conv-1' }
    );

    expect(result.versionId).toBe('version-2');
    expect(harness.buildFromSource).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conv-1',
      expectedBase: {
        ...EXPECTED_BASE,
        revisionId: 'version-3',
      },
      source: SOURCE.replace('Old title', 'New title'),
    });
  });

  it('reports non-unique edit matches with the Claude-aligned message', async () => {
    const duplicatedSource = `${SOURCE}\ncreateText({ content: "Old title" });`;
    const harness = makeHarness({
      document: makeDocument({ deckSource: duplicatedSource }),
    });

    await expect(
      harness.service.edit(
        {
          presentation_id: 'deck-1',
          old_string: 'Old title',
          new_string: 'New title',
        },
        { conversationId: 'conv-1' }
      )
    ).rejects.toEqual(
      new CodegenPresentationError(
        'Found 2 matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.\nString: Old title',
        9
      )
    );
  });

  it('reports missing edit strings with the Claude-aligned message', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.edit(
        {
          presentation_id: 'deck-1',
          old_string: 'Missing title',
          new_string: 'New title',
        },
        { conversationId: 'conv-1' }
      )
    ).rejects.toEqual(
      new CodegenPresentationError(
        'String to replace not found in deck source.\nString: Missing title',
        8
      )
    );
    expect(harness.buildFromSource).not.toHaveBeenCalled();
  });

  it('creates a new deck with write_file and records it as read in the conversation', async () => {
    const diagnostics: readonly CodegenDiagnostic[] = [
      {
        phase: 'structure',
        severity: 'warning',
        code: 'LAYOUT_UNATTACHED_RENDERABLE_NODE',
        message: '元素未挂载。',
        hint: '将元素加入 Slide。',
        slideNumber: 1,
        sourceSpan: { startLine: 3, endLine: 3 },
      },
    ];
    const harness = makeHarness({ diagnostics, parseWarnings: ['legacy warning'] });

    const result = await harness.service.write(
      { source: SOURCE },
      { conversationId: 'conv-1', projectId: 'project-1' }
    );

    expect(harness.buildNewPresentation).toHaveBeenCalledWith({
      source: SOURCE,
      projectId: 'project-1',
      conversationId: 'conv-1',
    });
    expect(result).toMatchObject({
      type: 'create',
      presentationId: 'deck-new',
      versionId: 'version-new',
      source: SOURCE,
      slideCount: 2,
      diagnostics,
      parseWarnings: ['legacy warning'],
    });
    expect(harness.registry.get('conv-1', 'deck-new')).toMatchObject({
      sourceKey: 'compiled:version-new',
      contentSnapshot: SOURCE,
      isPartialView: false,
    });
  });

  it('首次源码编译失败时返回已保存 draft，而不是让 VFS 创建全盘失败', async () => {
    const harness = makeHarness({ enableInitialDraftCreator: true });
    const source = 'interface Broken { x: number; }';

    const result = await harness.service.write(
      { source },
      {
        conversationId: 'conv-1',
        projectId: 'project-1',
        requestedTitle: '复杂演示.slides',
      }
    );

    expect(result).toMatchObject({
      type: 'create',
      buildStatus: 'draft',
      presentationId: 'deck-new',
      versionId: 'version-new',
      source,
      draftStatus: {
        baseVersionId: 'version-new',
        errorKind: 'slides.codegen.typecheck',
      },
      buildFailure: {
        code: 'slides.codegen.typecheck',
        draftSaved: true,
        presentationId: 'deck-new',
      },
    });
    expect(harness.initialDraftCreator.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source,
        title: '复杂演示.slides',
        projectId: 'project-1',
        failure: expect.objectContaining({ code: 'slides.codegen.typecheck' }),
      })
    );
    expect(harness.registry.get('conv-1', 'deck-new')).toMatchObject({
      sourceKey: expect.stringMatching(/^draft:/),
      contentSnapshot: source,
    });
  });

  it('overwrites an existing deck without a prior read', async () => {
    const diagnostics: readonly CodegenDiagnostic[] = [
      {
        phase: 'structure',
        severity: 'warning',
        code: 'LAYOUT_UNATTACHED_CONFIGURED_CONTAINER',
        message: 'Frame 未挂载。',
        hint: '检查 .add(...)。',
        sourceSpan: { startLine: 8, endLine: 8 },
      },
    ];
    const harness = makeHarness({ diagnostics, parseWarnings: ['legacy warning'] });
    const updatedSource = SOURCE.replace('Old title', 'Written title');

    const result = await harness.service.write(
      { presentation_id: 'deck-1', source: updatedSource },
      { conversationId: 'conv-1', projectId: 'project-1' }
    );

    expect(harness.buildFromSource).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conv-1',
      expectedBase: EXPECTED_BASE,
      source: updatedSource,
    });
    expect(result).toMatchObject({
      type: 'update',
      presentationId: 'deck-1',
      versionId: 'version-2',
      source: updatedSource,
      originalSource: SOURCE,
      slideCount: 2,
      diagnostics,
      parseWarnings: ['legacy warning'],
    });
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: 'compiled:version-2',
      contentSnapshot: updatedSource,
      isPartialView: false,
    });
  });

  it('edit_file VFS receipt 过期时不进入 builder 也不保存 draft', async () => {
    const harness = makeHarness({
      document: makeDocument({
        currentRevisionId: 'version-2',
        currentRevision: 2,
        sourceHash: 'source-hash-2',
      }),
    });

    await expect(
      harness.service.write(
        {
          presentation_id: 'deck-1',
          source: SOURCE.replace('Old title', 'Stale edit'),
          expected_source_key: 'compiled:version-1',
        },
        { conversationId: 'conv-1', projectId: 'project-1' }
      )
    ).rejects.toMatchObject({
      errorCode: 9,
      message: expect.stringContaining('Use read_file to reload'),
    });
    expect(harness.buildFromSource).not.toHaveBeenCalled();
    expect(harness.draftRepo.upsert).not.toHaveBeenCalled();
  });

  it('saves an existing-deck typecheck failure as a draft and invalidates the read state', async () => {
    const harness = makeHarness();
    await harness.service.read({ presentation_id: 'deck-1' }, { conversationId: 'conv-1' });

    const result = await harness.service.write(
      { presentation_id: 'deck-1', source: 'interface Broken { x: number; }' },
      { conversationId: 'conv-1', projectId: 'project-1' }
    );
    expect(result).toMatchObject({
      type: 'update',
      buildStatus: 'draft',
      buildFailure: {
        code: 'slides.codegen.typecheck',
        phase: 'typecheck',
        retryable: false,
        sourceFixable: true,
        draftSaved: true,
        presentationId: 'deck-1',
        expectedRevision: { revisionId: 'version-1', revision: 1 },
      },
      draftStatus: {
        errorKind: 'slides.codegen.typecheck',
      },
    });

    expect(harness.draftRepo.upsert).toHaveBeenCalledWith(
      'deck-1',
      'interface Broken { x: number; }',
      expect.objectContaining({ currentRevisionId: 'version-1' }),
      expect.stringContaining('TS8006'),
      'slides.codegen.typecheck'
    );
    expect(harness.registry.get('conv-1', 'deck-1')).toMatchObject({
      sourceKey: expect.stringMatching(/^draft:/),
      contentSnapshot: 'interface Broken { x: number; }',
    });
    expect(harness.buildFromSource).not.toHaveBeenCalled();
  });

  it('saves an existing-deck build failure as a draft', async () => {
    const harness = makeHarness({
      buildFromSourceError: new PresentationBuildFailureError(
        createPresentationBuildFailure({
          code: 'slides.codegen.sandbox',
          summary: 'ReferenceError: bad is not defined',
        })
      ),
    });
    const updatedSource = SOURCE.replace('Old title', 'Broken title');
    await harness.service.read({ presentation_id: 'deck-1' }, { conversationId: 'conv-1' });

    const result = await harness.service.write(
      { presentation_id: 'deck-1', source: updatedSource },
      { conversationId: 'conv-1', projectId: 'project-1' }
    );
    expect(result).toMatchObject({
      buildStatus: 'draft',
      buildFailure: {
        code: 'slides.codegen.sandbox',
        phase: 'sandbox',
        sourceFixable: true,
        draftSaved: true,
      },
    });

    expect(harness.draftRepo.upsert).toHaveBeenCalledWith(
      'deck-1',
      updatedSource,
      expect.objectContaining({ currentRevisionId: 'version-1' }),
      'ReferenceError: bad is not defined',
      'slides.codegen.sandbox'
    );
  });

  it('资产 store 故障保留同一 source draft，但明确禁止随机改稿', async () => {
    const harness = makeHarness({
      buildFromSourceError: new PresentationBuildFailureError(
        createPresentationBuildFailure({
          code: 'slides.asset.store_unavailable',
          summary: 'The managed image store is unavailable.',
        })
      ),
    });

    const result = await harness.service.write(
      { presentation_id: 'deck-1', source: SOURCE.replace('Old title', 'Pending title') },
      { conversationId: 'conv-1', projectId: 'project-1' }
    );
    expect(result).toMatchObject({
      buildStatus: 'draft',
      buildFailure: {
        code: 'slides.asset.store_unavailable',
        phase: 'asset',
        retryable: true,
        sourceFixable: false,
        draftSaved: true,
      },
    });
    expect(harness.draftRepo.upsert).toHaveBeenCalledWith(
      'deck-1',
      expect.stringContaining('Pending title'),
      expect.anything(),
      'The managed image store is unavailable.',
      'slides.asset.store_unavailable'
    );
  });

  it('并发修订冲突时不保存过时 draft，要求重新读取', async () => {
    const harness = makeHarness({
      buildFromSourceError: new PresentationStaleBaseError(
        'deck-1',
        'version-1',
        1,
        'version-2',
        2
      ),
    });

    await expect(
      harness.service.edit(
        {
          presentation_id: 'deck-1',
          old_string: 'Old title',
          new_string: 'Conflicting title',
        },
        { conversationId: 'conv-1' }
      )
    ).rejects.toMatchObject({
      name: 'CodegenPresentationError',
      errorCode: 9,
      message: expect.stringContaining('Use read_file to reload'),
    });
    expect(harness.draftRepo.upsert).not.toHaveBeenCalled();
    expect(harness.draftRepo.delete).not.toHaveBeenCalled();
  });

  it('does not report a saved draft when the draft base is stale', async () => {
    const harness = makeHarness({
      buildFromSourceError: new PresentationBuildFailureError(
        createPresentationBuildFailure({
          code: 'slides.codegen.sandbox',
          summary: 'ReferenceError: bad is not defined',
        })
      ),
      draftUpsertError: new PresentationDraftStaleBaseError(
        'deck-1',
        'version-1',
        1,
        'version-2',
        2
      ),
    });
    const updatedSource = SOURCE.replace('Old title', 'Broken title');
    await harness.service.read({ presentation_id: 'deck-1' }, { conversationId: 'conv-1' });

    await expect(
      harness.service.write(
        { presentation_id: 'deck-1', source: updatedSource },
        { conversationId: 'conv-1', projectId: 'project-1' }
      )
    ).rejects.toMatchObject({
      errorCode: 9,
      failure: {
        code: 'slides.conflict.stale_draft_base',
        phase: 'conflict',
        draftSaved: false,
      },
    });

    await expect(
      harness.service.write(
        { presentation_id: 'deck-1', source: updatedSource },
        { conversationId: 'conv-1', projectId: 'project-1' }
      )
    ).rejects.not.toMatchObject({
      failure: { draftSaved: true },
    });
    expect(harness.registry.get('conv-1', 'deck-1')).toBeUndefined();
  });

  it('edits a pending draft and clears it after a successful compile', async () => {
    const draft = makeDraft();
    const harness = makeHarness({ draft });
    await harness.service.read({ presentation_id: 'deck-1' }, { conversationId: 'conv-1' });

    const result = await harness.service.edit(
      {
        presentation_id: 'deck-1',
        old_string: 'Draft title',
        new_string: 'Fixed title',
      },
      { conversationId: 'conv-1' }
    );

    expect(harness.buildFromSource).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conv-1',
      expectedBase: EXPECTED_BASE,
      source: draft.deckSource.replace('Draft title', 'Fixed title'),
    });
    expect(harness.draftRepo.delete).toHaveBeenCalledWith('deck-1');
    expect(result.originalSource).toBe(draft.deckSource);
  });

  it('searches deck source with grep count mode', async () => {
    const harness = makeHarness();

    const result = await harness.service.grep({
      presentation_id: 'deck-1',
      pattern: 'createText',
      output_mode: 'count',
    });

    expect(result).toMatchObject({
      presentationId: 'deck-1',
      versionId: 'version-1',
      mode: 'count',
      matchCount: 2,
      content: 'deck-1:2\n\nFound 2 total occurrences across 1 files.',
    });
  });

  it('searches the pending draft source with grep', async () => {
    const harness = makeHarness({ draft: makeDraft() });

    const result = await harness.service.grep({
      presentation_id: 'deck-1',
      pattern: 'Draft title',
      output_mode: 'content',
    });

    expect(result).toMatchObject({
      presentationId: 'deck-1',
      versionId: 'version-1',
      sourceOrigin: 'draft',
      sourceKey: 'draft:draft-hash-1',
      matchCount: 1,
      content: '3:createText({ content: "Draft title" });',
    });
  });

  it('includes grep context lines around content matches', async () => {
    const harness = makeHarness();

    const result = await harness.service.grep({
      presentation_id: 'deck-1',
      pattern: 'Detail',
      output_mode: 'content',
      '-C': 1,
    });

    expect(result.content).toBe(
      [
        '6:const detail = createSlide();',
        '7:createText({ content: "Detail" });',
        '8:// === END SLIDE 2 ===',
      ].join('\n')
    );
  });

  it('supports grep slide scope, case-insensitive search, multiline search, and count miss output', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.grep({
        presentation_id: 'deck-1',
        pattern: 'createText',
        slide: 99,
      })
    ).rejects.toEqual(new CodegenPresentationError('slide 99 does not exist', 8));

    await expect(
      harness.service.grep({
        presentation_id: 'deck-1',
        pattern: '[',
      })
    ).rejects.toMatchObject({
      errorCode: 1,
    });

    await expect(
      harness.service.grep({
        presentation_id: 'deck-1',
        pattern: 'Missing',
        output_mode: 'count',
      })
    ).resolves.toMatchObject({
      matchCount: 0,
      content:
        'No matches found. Tips: try { "-i": true } for case-insensitive, multiline:true for cross-line patterns, or relax the regex (escape literal {} () . with backslash).',
    });

    await expect(
      harness.service.grep({
        presentation_id: 'deck-1',
        pattern: 'old title',
        output_mode: 'content',
        '-i': true,
      })
    ).resolves.toMatchObject({
      matchCount: 1,
      content: '3:createText({ content: "Old title" });',
    });

    await expect(
      harness.service.grep({
        presentation_id: 'deck-1',
        pattern: 'const detail[\\s\\S]*?Detail',
        output_mode: 'content',
        multiline: true,
      })
    ).resolves.toMatchObject({
      matchCount: 1,
      content: '6:const detail = createSlide();',
    });
  });

  it('returns structure rows with createSlide()-derived line ranges and element counts', async () => {
    const harness = makeHarness();

    const result = await harness.service.structure({ presentation_id: 'deck-1' });

    expect(result).toMatchObject({
      presentationId: 'deck-1',
      versionId: 'version-1',
      totalLines: 9,
      slideCount: 2,
      slides: [
        {
          slideNumber: 1,
          startLine: 2,
          endLine: 5,
          titleGuess: 'Old title',
          elementCounts: { text: 1 },
        },
        {
          slideNumber: 2,
          startLine: 6,
          endLine: 9,
          titleGuess: 'Detail',
          elementCounts: { text: 1 },
        },
      ],
    });
    for (const slide of result.slides) {
      expect(slide).not.toHaveProperty('markerName');
    }
  });

  it('returns draft structure without reusing compiled element counts', async () => {
    const harness = makeHarness({ draft: makeDraft() });

    const result = await harness.service.structure({ presentation_id: 'deck-1' });

    expect(result).toMatchObject({
      presentationId: 'deck-1',
      versionId: 'version-1',
      sourceOrigin: 'draft',
      sourceKey: 'draft:draft-hash-1',
    });
    expect(result.slides[0]).toMatchObject({
      slideNumber: 1,
      titleGuess: 'Draft title',
      elementCountsUnavailable: true,
    });
    expect(result.slides[0]?.elementCounts).toEqual({});
    expect(result.slides.every(slide => slide.elementCountsUnavailable === true)).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PptCoordinator } from '@plugin/slides/backend-coordinator';
import type {
  PresentationDocumentRecord,
  PresentationDraftRepositoryPort,
  PresentationRepositoryPort,
  TemplateManagerPort,
  WorkspacePresentationPort,
} from '@plugin/slides/backend-coordinator';
import type { DeckSpec } from '@plugin/slides/shared';
import type {
  DeckAssemblerPort,
  PptxReaderPort,
} from '../engine/types.js';
import { createInProcessPresentationBuildExecution } from '../features/presentationBuildExecution';

const deckSpec: DeckSpec = {
  title: 'Quarterly Review',
  layout: '16x9',
  slides: [
    {
      slideNumber: 1,
      spec: {
        type: 'freeform',
        elements: [{
          type: 'text',
          content: 'Quarterly Review',
          position: { x: 1, y: 1, w: 8, h: 1 },
          _sourceSpan: { startLine: 2, endLine: 2 },
        }],
      },
    },
  ],
};

function makeDocument(overrides: Partial<PresentationDocumentRecord> = {}): PresentationDocumentRecord {
  return {
    nodeId: 'node-1',
    currentRevisionId: 'revision-7',
    currentRevision: 7,
    deckSource: [
      'const slide = createSlide();',
      'const title = createText("Quarterly Review");',
      'slide.add(title);',
      'compose({ title: "Quarterly Review", slides: [slide] });',
    ].join('\n'),
    sourceHash: 'source-hash-7',
    deckSpec,
    pptxArtifact: {
      state: 'ready',
      revisionId: overrides.currentRevisionId ?? 'revision-7',
      buffer: Buffer.from('stored-pptx'),
    },
    title: deckSpec.title,
    slideCount: 1,
    layout: '16x9',
    createdAt: 1,
    updatedAt: 7,
    ...overrides,
  };
}

describe('PptCoordinator', () => {
  let presentationRepo: PresentationRepositoryPort;
  let draftRepo: PresentationDraftRepositoryPort;
  let deckAssembler: DeckAssemblerPort;
  let pptxReader: PptxReaderPort;
  let coordinator: PptCoordinator;

  beforeEach(() => {
    deckAssembler = {
      assemble: vi.fn(async () => Buffer.from('compiled-pptx')),
    };
    pptxReader = {
      parse: vi.fn(async () => ({
        slideCount: 1,
        slideSize: { width: 13.333, height: 7.5 },
        slides: [{ number: 1, elements: [] }],
        theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
        masters: [],
      })),
    };
    presentationRepo = {
      createPresentation: vi.fn(async () => ({ revisionId: 'revision-1', revision: 1 })),
      commitPresentation: vi.fn(async () => ({ revisionId: 'revision-8', revision: 8 })),
      getPresentation: vi.fn(async () => makeDocument()),
      getPresentationIdentity: vi.fn(async () => ({
        nodeId: 'node-1',
        currentRevisionId: 'revision-7',
        currentRevision: 7,
        sourceHash: 'source-hash-7',
      })),
      getPresentationPreviewSource: vi.fn(async () => ({
        nodeId: 'node-1',
        currentRevisionId: 'revision-7',
        currentRevision: 7,
        deckSpec,
        title: deckSpec.title,
      })),
      getPresentationRenderSource: vi.fn(async () => ({
        nodeId: 'node-1',
        currentRevisionId: 'revision-7',
        currentRevision: 7,
        deckSource: makeDocument().deckSource,
        deckSpec,
        title: deckSpec.title,
      })),
      getPresentationPptxArtifactSource: vi.fn(async () => ({
        nodeId: 'node-1',
        currentRevisionId: 'revision-7',
        currentRevision: 7,
        deckSource: makeDocument().deckSource,
        deckSpec,
        title: deckSpec.title,
        artifact: { state: 'ready', revisionId: 'revision-7', buffer: Buffer.from('stored-pptx') },
      })),
      savePresentationPptxArtifact: vi.fn(async () => true),
      getRevisionSource: vi.fn(async () => null),
      listRevisions: vi.fn(async () => []),
      saveTemplate: vi.fn(async () => 'template-1'),
      getTemplate: vi.fn(async () => null),
      listTemplates: vi.fn(async () => []),
      incrementTemplateUsage: vi.fn(async () => {}),
    };
    draftRepo = {
      upsert: vi.fn(() => {
        throw new Error('not used');
      }),
      get: vi.fn(() => null),
      has: vi.fn(() => false),
      delete: vi.fn(() => {}),
    };
    const templateManager: TemplateManagerPort = {
      importFromPptx: vi.fn(async () => {
        throw new Error('not used');
      }),
      getTheme: vi.fn(async () => null),
    };
    const workspaceService: WorkspacePresentationPort = {
      createPresentationNode: vi.fn(async () => 'node-1'),
      deletePresentationNode: vi.fn(async () => {}),
    };

    coordinator = new PptCoordinator(
      deckAssembler,
      pptxReader,
      templateManager,
      presentationRepo,
      workspaceService,
      undefined,
      draftRepo,
      { buildExecution: createInProcessPresentationBuildExecution() },
    );
  });

  it('rejects compiled document operations while a codegen draft is pending', async () => {
    vi.mocked(draftRepo.has).mockReturnValue(true);

    await expect(coordinator.inspect('node-1')).rejects.toThrow('unresolved deck.js draft');
    await expect(coordinator.export('node-1')).rejects.toThrow('unresolved deck.js draft');
    await expect(coordinator.getPreview('node-1')).rejects.toThrow('unresolved deck.js draft');
    await expect(coordinator.getRenderModel('node-1')).rejects.toThrow('unresolved deck.js draft');
  });

  it('returns pending draft as a typed document build state', async () => {
    vi.mocked(draftRepo.get).mockReturnValue({
      nodeId: 'node-1',
      deckSource: 'broken source',
      sourceHash: 'draft-hash',
      baseRevisionId: 'revision-7',
      baseRevision: 7,
      lastErrorSummary: 'TS8006 at line 1',
      lastErrorKind: 'slides.codegen.typecheck',
      createdAt: 8,
      updatedAt: 9,
    });

    await expect(coordinator.getDocumentBuildState('node-1')).resolves.toEqual({
      state: 'draft',
      presentationId: 'node-1',
      versionId: 'revision-7',
      versionNumber: 7,
      sourceHash: 'source-hash-7',
      draftStatus: {
        baseVersionId: 'revision-7',
        baseVersionNumber: 7,
        errorKind: 'slides.codegen.typecheck',
        errorSummary: 'TS8006 at line 1',
        updatedAt: 9,
      },
    });
  });

  it('maps the current document to the existing generated render-model contract', async () => {
    const model = await coordinator.getRenderModel('node-1');

    expect(model).toMatchObject({
      presentationId: 'node-1',
      version: 7,
      sourceKind: 'generated',
      capabilities: {
        hasSemanticRender: true,
        canEditSourceSelection: true,
      },
    });
    expect(model.slides[0]?.elements[0]).toMatchObject({
      kind: 'text',
      sourceSpan: { startLine: 2, endLine: 2 },
      paragraphs: [{ runs: [{ text: 'Quarterly Review' }] }],
    });
    expect(pptxReader.parse).not.toHaveBeenCalled();
    expect(deckAssembler.assemble).not.toHaveBeenCalled();
  });

  it('keeps current revision identity in preview and export queries', async () => {
    const preview = await coordinator.getPreview('node-1');
    const exported = await coordinator.export('node-1');

    expect(preview.nodeId).toBe('node-1');
    expect(preview.versionNumber).toBe(7);
    expect(exported.fileName).toBe('Quarterly Review.pptx');
    expect(exported.buffer).toEqual(Buffer.from('stored-pptx'));
  });

  it('uses narrow current projections for renderer document queries', async () => {
    const buildState = await coordinator.getDocumentBuildState('node-1');
    const sourceKind = await coordinator.getSourceKind('node-1');
    const preview = await coordinator.getPreview('node-1');
    const renderModel = await coordinator.getRenderModel('node-1');

    expect(buildState).toMatchObject({ versionId: 'revision-7', versionNumber: 7 });
    expect(sourceKind).toBe('generated');
    expect(preview).toMatchObject({ nodeId: 'node-1', versionNumber: 7 });
    expect(renderModel).toMatchObject({ presentationId: 'node-1', version: 7 });
    expect(presentationRepo.getPresentationIdentity).toHaveBeenCalledTimes(2);
    expect(presentationRepo.getPresentationPreviewSource).toHaveBeenCalledOnce();
    expect(presentationRepo.getPresentationRenderSource).toHaveBeenCalledOnce();
    expect(presentationRepo.getPresentation).not.toHaveBeenCalled();
  });

  it('recovers missing source spans through the shared codegen builder', async () => {
    const specWithoutSourceSpan: DeckSpec = {
      ...deckSpec,
      slides: deckSpec.slides.map((slide) => ({
        ...slide,
        spec: slide.spec.type === 'freeform'
          ? {
            ...slide.spec,
            elements: slide.spec.elements.map((element) => {
              const withoutSourceSpan = { ...element };
              delete withoutSourceSpan._sourceSpan;
              return withoutSourceSpan;
            }),
          }
          : slide.spec,
      })),
    };
    const renderSourceDocument = makeDocument({ deckSpec: specWithoutSourceSpan });
    vi.mocked(presentationRepo.getPresentationRenderSource).mockResolvedValue({
      nodeId: renderSourceDocument.nodeId,
      currentRevisionId: renderSourceDocument.currentRevisionId,
      currentRevision: renderSourceDocument.currentRevision,
      deckSource: renderSourceDocument.deckSource,
      deckSpec: renderSourceDocument.deckSpec,
      title: renderSourceDocument.title,
    });
    const recoveredDeckSpec = deckSpec;
    const codegenBuilder = {
      buildNewPresentation: vi.fn(async () => ({
        nodeId: 'node-1',
        versionId: 'revision-1',
        versionNumber: 1,
        deckSpec: recoveredDeckSpec,
        pptxBuffer: Buffer.from('pptx'),
        diagnostics: [],
        parseWarnings: [],
      })),
      buildFromSource: vi.fn(async () => ({
        versionId: 'revision-8',
        versionNumber: 8,
        deckSpec: recoveredDeckSpec,
        pptxBuffer: Buffer.from('pptx'),
        diagnostics: [],
        parseWarnings: [],
      })),
      buildFromProjectedDeckSpec: vi.fn(async input => ({
        versionId: 'revision-8',
        versionNumber: 8,
        deckSpec: input.deckSpec,
        pptxBuffer: Buffer.from('pptx'),
      })),
      buildDeckSpecFromSource: vi.fn(async () => recoveredDeckSpec),
    };
    const codegenBuilderFactory = vi.fn(() => codegenBuilder);
    coordinator = new PptCoordinator(
      deckAssembler,
      pptxReader,
      {
        importFromPptx: vi.fn(async () => {
          throw new Error('not used');
        }),
        getTheme: vi.fn(async () => null),
      },
      presentationRepo,
      undefined,
      undefined,
      draftRepo,
      {
        codegenDeckBuilderFactory: codegenBuilderFactory,
        buildExecution: createInProcessPresentationBuildExecution(),
      },
    );

    const model = await coordinator.getRenderModel('node-1');

    expect(codegenBuilderFactory).toHaveBeenCalledTimes(1);
    expect(codegenBuilder.buildDeckSpecFromSource).toHaveBeenCalledWith({
      nodeId: 'node-1',
      source: makeDocument().deckSource,
    });
    expect(model.capabilities.canEditSourceSelection).toBe(true);
  });

  it('reports missing current documents directly', async () => {
    vi.mocked(presentationRepo.getPresentationPreviewSource).mockResolvedValue(null);

    await expect(coordinator.getPreview('missing-node')).rejects.toThrow(
      'Presentation not found: missing-node',
    );
  });
});

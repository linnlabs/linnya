import { describe, expect, it, vi } from 'vitest';
import type { DeckSpec } from '@plugin/slides/shared';
import type {
  PresentationDocumentRecord,
  PresentationDraftRepositoryPort,
} from '../../persistence';
import { createPresentationBuildFailure } from '../../features/presentationBuildFailure';
import type { CodegenPresentationBuilderPort } from '../CodegenPresentationTypes';
import { InitialPresentationDraftCreator } from '../InitialPresentationDraftCreator';

const DECK_SPEC: DeckSpec = {
  title: 'broken.slides',
  layout: '16x9',
  slides: [{ slideNumber: 1, spec: { type: 'freeform', elements: [] } }],
};

function makeDocument(): PresentationDocumentRecord {
  return {
    nodeId: 'slides-shell',
    currentRevisionId: 'version-1',
    currentRevision: 1,
    deckSource: 'const slide = createSlide();',
    sourceHash: 'shell-hash',
    deckSpec: DECK_SPEC,
    pptxBuffer: Buffer.from('pptx'),
    title: 'broken.slides',
    slideCount: 1,
    layout: '16x9',
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeHarness(options: { readonly draftFails?: boolean } = {}) {
  const document = makeDocument();
  const buildNewPresentation = vi.fn(async () => ({
    nodeId: document.nodeId,
    versionId: document.currentRevisionId,
    versionNumber: document.currentRevision,
    deckSpec: DECK_SPEC,
    pptxBuffer: document.pptxBuffer,
    diagnostics: [],
    parseWarnings: [],
  }));
  const builder: CodegenPresentationBuilderPort = {
    buildNewPresentation,
    buildFromSource: vi.fn(),
  };
  const draftRepo: PresentationDraftRepositoryPort = {
    upsert: vi.fn((nodeId, source, base, summary, errorKind) => {
      if (options.draftFails) throw new Error('database unavailable');
      return {
        nodeId,
        deckSource: source,
        sourceHash: 'draft-hash',
        baseRevisionId: base.currentRevisionId,
        baseRevision: base.currentRevision,
        lastErrorSummary: summary,
        lastErrorKind: errorKind,
        createdAt: 2,
        updatedAt: 2,
      };
    }),
    get: vi.fn(() => null),
    has: vi.fn(() => false),
    delete: vi.fn(),
  };
  const deletePresentationNode = vi.fn(async () => {});
  const discardPresentationShell = vi.fn(async () => {});
  const creator = new InitialPresentationDraftCreator({
    builder,
    presentationRepo: { getPresentation: vi.fn(async () => document) },
    draftRepo,
    deletePresentationNode,
    discardPresentationShell,
  });
  return {
    creator,
    buildNewPresentation,
    draftRepo,
    deletePresentationNode,
    discardPresentationShell,
  };
}

describe('InitialPresentationDraftCreator', () => {
  it('用有效空白基线建立文档，但把用户原源码保存为 draft', async () => {
    const harness = makeHarness();
    const source = 'interface Broken { x: number; }';
    const failure = createPresentationBuildFailure({
      code: 'slides.codegen.typecheck',
      summary: 'TS8006 at line 1',
    });

    const result = await harness.creator.create({
      source,
      title: 'broken.slides',
      failure,
      projectId: 'project-1',
    });

    expect(harness.buildNewPresentation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      source: expect.stringContaining('compose({ title: "broken.slides"'),
    }));
    expect(harness.draftRepo.upsert).toHaveBeenCalledWith(
      'slides-shell',
      source,
      expect.objectContaining({ currentRevisionId: 'version-1' }),
      failure.summary,
      failure.code
    );
    expect(result.draft.deckSource).toBe(source);
    expect(harness.deletePresentationNode).not.toHaveBeenCalled();
    expect(harness.discardPresentationShell).not.toHaveBeenCalled();
  });

  it('draft 未保存时删除刚建立的 presentation shell', async () => {
    const harness = makeHarness({ draftFails: true });

    await expect(harness.creator.create({
      source: 'broken source',
      title: 'broken.slides',
      failure: createPresentationBuildFailure({
        code: 'slides.codegen.sandbox',
        summary: 'ReferenceError',
      }),
      projectId: 'project-1',
    })).rejects.toMatchObject({
      failure: { code: 'slides.persistence.draft_failed' },
    });
    expect(harness.deletePresentationNode).toHaveBeenCalledWith('slides-shell');
    expect(harness.discardPresentationShell).toHaveBeenCalledWith('slides-shell');
  });
});

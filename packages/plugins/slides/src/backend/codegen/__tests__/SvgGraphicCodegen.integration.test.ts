import { describe, expect, it, vi } from 'vitest';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { pptComposeProfile } from '../../sandbox/pptComposeProfile';
import { CodegenDeckBuilder } from '../CodegenDeckBuilder';
import { createInProcessPresentationBuildExecution } from '../../features/presentationBuildExecution';

const SOURCE = `
const slide = createSlide();
slide.add(createSvgGraphic({
  source: '<svg viewBox="0 0 100 50"><path d="M0 25L100 25" stroke="#2563EB" stroke-width="4"/></svg>',
  position: 'absolute',
  x: 1,
  y: 1,
  width: 6,
  height: 3,
  altText: '一条蓝色水平流程线',
}));
compose({ title: 'SVG Graphic E2E', slides: [slide] });
`;

describe('SVG Graphic codegen integration', () => {
  it('Agent 公开语法经过文稿接管后只把 owned ref 写入 DeckSpec', async () => {
    const service = createSandboxService();
    const createPresentationNode = vi.fn(async () => 'presentation-svg-1');
    const ownSource = vi.fn(async () => ({
      kind: 'owned_svg' as const,
      assetId: 'svg-asset-1',
      contentHash: 'a'.repeat(64),
      byteLength: 106,
      viewBox: { width: 100, height: 50 },
    }));
    const assembleDeck = vi.fn(async () => Buffer.from('pptx'));
    const createPresentation = vi.fn(async () => ({ revisionId: 'revision-1', revision: 1 }));
    const builder = new CodegenDeckBuilder({
      presentationRepo: {
        createPresentation,
        commitPresentation: vi.fn(async () => ({ revisionId: 'revision-2', revision: 2 })),
        getPresentation: vi.fn(async () => null),
      },
      engine: { assembleDeck },
      sandbox: { execute: request => service.execute(request) },
      buildExecution: createInProcessPresentationBuildExecution(),
      workspaceService: {
        createPresentationNode,
        deletePresentationNode: vi.fn(async () => undefined),
      },
      svgGraphicOwner: { ownSource },
    });

    const result = await builder.buildNewPresentation({
      source: SOURCE,
      projectId: 'project-1',
      conversationId: 'conversation-1',
    });

    expect(createPresentationNode).toHaveBeenCalledWith(expect.objectContaining({
      title: 'SVG Graphic E2E',
    }));
    expect(ownSource).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'inline_svg', svg: expect.stringContaining('<svg') }),
      { documentId: 'presentation-svg-1', conversationId: 'conversation-1' },
    );
    expect(result.deckSpec.slides[0].spec.elements[0]).toEqual(expect.objectContaining({
      type: 'svgGraphic',
      asset: expect.objectContaining({ assetId: 'svg-asset-1' }),
      fit: 'contain',
      altText: '一条蓝色水平流程线',
    }));
    expect(JSON.stringify(result.deckSpec)).not.toContain('<svg');
    expect(assembleDeck).toHaveBeenCalledWith(expect.objectContaining({
      deckSpec: result.deckSpec,
      assembleOptions: {
        assetContext: {
          documentId: 'presentation-svg-1',
          projectId: 'project-1',
          conversationId: 'conversation-1',
        },
      },
    }));
    expect(createPresentation).toHaveBeenCalledOnce();
  });
});

function createSandboxService(): SandboxService {
  const registry = new SandboxProfileRegistry();
  registry.register(pptComposeProfile);
  return new SandboxService(registry, createSandboxEvaluatorTestRunner());
}

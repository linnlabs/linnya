import { describe, expect, it, vi } from 'vitest';
import { assertToolParameterSchema } from '@linnlabs/linnkit/runtime-kernel';
import type { ToolContext } from '@plugin/backend/toolRuntime';
import type {
  DeckSpec,
  EditableOperation,
  EditableTarget,
  PresentationRenderModel,
  RenderNode,
  SceneGraphNodeSummary,
} from '@plugin/slides/shared';
import {
  PptInspectToolResultSchema,
  buildNodeToolCapabilities,
  buildSlideTools,
  collectEditableTargetsBySlide,
} from '@plugin/slides/shared';
import {
  getDiagnosticCodePolicy,
  type DiagnosticFinding,
} from '../engine/quality/definitions';
import { SlidesCliExitCode } from '../features/presentationCli/definitions/slidesCli';
import {
  executeSlidesCliCommand,
} from '../features/presentationCli/orchestration/executeSlidesCliCommand';
import type { DiagnosticToolFeedbackPayload } from '../features/presentationInspection';
import {
  createSlidesBackendToolClasses,
  slidesToolManifest,
} from '../toolClasses';
import { PptExportTool } from './PptExportTool';
import { PptInspectTool } from './PptInspectTool';
import { PptPlanTool } from './PptPlanTool';
import {
  attachPresentationCoordinatorToToolContext,
  attachPresentationInspectTargetResolverToToolContext,
} from './toolContextBinding';
import type { CodegenPresentationServicePort, PresentationToolCoordinatorPort } from './types';

// ─── Mock Coordinator ─────────────────────────────────────────────────────────

const CODEGEN_SOURCE = [
  '// === SLIDE 1: cover ===',
  'const slide = createSlide();',
  'createText({ content: "Quarterly Review" });',
  'slide.add();',
  '',
  '',
  '',
  '// === END SLIDE 1 ===',
  'compose({ title: "Test Deck", slides: [slide] });',
].join('\n');

const RETIRED_SLIDES_EDIT_TOOL_NAMES = [
  'ppt_edit_text',
  'ppt_edit_data',
  'ppt_edit_image',
  'ppt_edit_style',
  'ppt_edit_geometry',
  'ppt_edit_arrangement',
  'ppt_align_elements',
  'ppt_delete_element',
  'ppt_manage_slides',
] as const;

const CODEGEN_DECK_SPEC: DeckSpec = {
  title: 'Test Deck',
  layout: '16x9',
  slides: [
    {
      slideNumber: 1,
      spec: {
        type: 'freeform',
        elements: [
          { type: 'text', content: 'Quarterly Review', position: { x: 1, y: 1, w: 8, h: 1 } },
          { type: 'image', src: 'https://example.com/photo.jpg', position: { x: 1, y: 2, w: 5, h: 3 } },
        ],
      },
    },
  ],
};

function makeCodegenVersion() {
  return {
    id: 'v-codegen',
    nodeId: 'pres-1',
    versionNumber: 1,
    deckSpec: CODEGEN_DECK_SPEC,
    deckSource: CODEGEN_SOURCE,
    sourceKind: 'generated',
    title: 'Test Deck',
    slideCount: 1,
    layout: '16x9',
    createdAt: 1,
  };
}

function makeMockCodegenPresentationService(
  version = makeCodegenVersion(),
): CodegenPresentationServicePort {
  return {
    read: vi.fn(async () => ({
      type: 'text' as const,
      file: {
        presentationId: version.nodeId,
        title: version.title,
        versionId: version.id,
        content: version.deckSource,
        numLines: version.deckSource?.split('\n').length,
        startLine: 1,
        totalLines: version.deckSource?.split('\n').length,
        sourceOrigin: 'compiled' as const,
        sourceKey: 'deck.js',
      },
    })),
    readSourceSlices: vi.fn(async () => ({
      presentationId: version.nodeId,
      title: version.title,
      versionId: version.id,
      sourceOrigin: 'compiled' as const,
      sourceKey: 'deck.js',
      totalLines: version.deckSource?.split('\n').length ?? 0,
      slices: [],
    })),
    edit: vi.fn(async () => ({
      presentationId: version.nodeId,
      title: version.title,
      versionId: 'v-edit',
      oldString: 'old',
      newString: 'new',
      originalSource: version.deckSource ?? '',
      structuredPatch: [],
      replaceAll: false,
      slideCount: version.slideCount,
      parseWarnings: [],
    })),
    write: vi.fn(async () => ({
      type: 'update' as const,
      presentationId: version.nodeId,
      title: version.title,
      versionId: 'v-write',
      source: version.deckSource ?? '',
      structuredPatch: [],
      originalSource: version.deckSource ?? '',
      slideCount: version.slideCount,
      parseWarnings: [],
    })),
    grep: vi.fn(async () => ({
      presentationId: version.nodeId,
      title: version.title,
      versionId: version.id,
      sourceOrigin: 'compiled' as const,
      sourceKey: 'deck.js',
      mode: 'content' as const,
      content: '',
      matchCount: 0,
    })),
    structure: vi.fn(async () => ({
      presentationId: version.nodeId,
      title: version.title,
      versionId: version.id,
      sourceOrigin: 'compiled' as const,
      sourceKey: 'deck.js',
      totalLines: version.deckSource?.split('\n').length ?? 0,
      slideCount: version.slideCount,
      slides: version.deckSource
        ? [{
            slideNumber: 1,
            startLine: 2,
            endLine: 9,
            titleGuess: version.title,
            elementCounts: { text: 1, image: 1 },
          }]
        : [],
    })),
  };
}

function makeMockRenderModel(): PresentationRenderModel {
  const textOps: EditableOperation[] = ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer'];
  return {
    presentationId: 'pres-1',
    title: 'Test Deck',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: [
      {
        slideId: 's1',
        index: 0,
        layoutKey: 'structured',
        background: { color: '#FFFFFF' },
        elements: [
          {
            id: 's1-generated-0',
            kind: 'text',
            box: { x: 1, y: 1, w: 8, h: 1, unit: 'in' },
            zIndex: 0,
            visible: true,
            paragraphs: [{ runs: [{ text: 'Quarterly Review' }] }],
            editableTarget: { slideNumber: 1, elementId: 's1-generated-0', operations: textOps },
          },
          {
            id: 's1-generated-1',
            kind: 'image',
            box: { x: 1, y: 2, w: 5, h: 3, unit: 'in' },
            zIndex: 1,
            visible: true,
            assetRef: { type: 'external', url: 'https://example.com/photo.jpg' },
            fitMode: 'contain',
            editableTarget: {
              slideNumber: 1,
              elementId: 's1-generated-1',
              operations: ['edit_image', 'modify_geometry', 'reorder_layer'],
              imageEditCapabilities: { replaceSource: true, editVisuals: true },
            },
          },
        ],
      },
    ],
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
}

function buildMinimalToolFeedback(
  presentationId: string,
  versionId: string,
  renderModel: PresentationRenderModel,
  editableTargetsBySlide: ReadonlyMap<number, readonly EditableTarget[]>,
  _changedSlides?: readonly number[],
  options?: { readonly sourceLocations?: ReadonlyMap<number, { readonly file: 'deck.js'; readonly slideNumber: number; readonly startLine: number; readonly endLine: number }> },
): DiagnosticToolFeedbackPayload {
  const sceneGraph = renderModel.slides.map((slide) => ({
    slideNumber: slide.index + 1,
    referenceFrames: [{
      id: `slide-${slide.index + 1}`,
      box: { x: 0, y: 0, w: renderModel.slideSize.width, h: renderModel.slideSize.height, unit: 'in' as const },
    }],
    rootNode: {
      nodeId: slide.slideId,
      slideNumber: slide.index + 1,
      kind: 'slide',
      box: { x: 0, y: 0, w: renderModel.slideSize.width, h: renderModel.slideSize.height, unit: 'in' as const },
      localBox: { x: 0, y: 0, w: renderModel.slideSize.width, h: renderModel.slideSize.height, unit: 'in' as const },
      zIndex: 0,
      sourceKind: renderModel.sourceKind,
      capabilities: { tools: buildSlideTools(renderModel.sourceKind) },
      referenceFrame: 'slide' as const,
      diagnostics: [],
      children: slide.elements.map((node) => buildSceneGraphNode(renderModel.sourceKind, node, slide.index + 1)),
    },
  }));
  const pageSummaries = renderModel.slides.map((slide) => {
    const slideNumber = slide.index + 1;
    return {
      slideNumber,
      layoutKey: slide.layoutKey,
      elementCount: countRenderableNodes(slide.elements),
      background: {
        ...(slide.background.color ? { color: slide.background.color } : {}),
        ...(slide.background.gradient ? { gradient: slide.background.gradient } : {}),
        ...(!slide.background.gradient && slide.background.imageSrc ? { imageSrc: slide.background.imageSrc } : {}),
      },
      editableTargets: [...(editableTargetsBySlide.get(slideNumber) ?? [])],
      slideTools: buildSlideTools(renderModel.sourceKind),
      ...(options?.sourceLocations?.get(slideNumber)
        ? { sourceLocation: options.sourceLocations.get(slideNumber) }
        : {}),
    };
  });

  return {
    artifact: {
      presentationId,
      versionId,
      slideCount: renderModel.slides.length,
    },
    pageSummaries,
    sceneGraph,
    spatialAnalysis: renderModel.slides.map((slide) => ({
      slideNumber: slide.index + 1,
      sourceKind: renderModel.sourceKind,
      isEmptySlide: countRenderableNodes(slide.elements) === 0,
      confidence: 1,
      summaryLines: [`${countRenderableNodes(slide.elements)} 个节点`],
      sections: [],
      relations: slide.elements.length > 1
        ? [{
            type: 'same_row' as const,
            slideNumber: slide.index + 1,
            nodeIds: slide.elements.slice(0, 2).map((node) => node.id),
            description: '主要元素位于同页布局中',
            confidence: 0.8,
          }]
        : [],
      debugLogs: [],
    })),
    buildStatus: { state: 'ready' },
    findings: buildMinimalFindings(renderModel, options?.sourceLocations),
  };
}

function buildSceneGraphNode(
  sourceKind: PresentationRenderModel['sourceKind'],
  node: RenderNode,
  slideNumber: number,
  parent?: SceneGraphNodeSummary,
): SceneGraphNodeSummary {
  const editableTarget = node.editableTarget;
  const style = readNodeStyle(node);
  const content = readNodeContent(node);
  const summary: SceneGraphNodeSummary = {
    nodeId: node.id,
    slideNumber,
    kind: node.kind,
    box: node.box,
    localBox: parent ? {
      x: roundInches(node.box.x - parent.box.x),
      y: roundInches(node.box.y - parent.box.y),
      w: node.box.w,
      h: node.box.h,
      unit: 'in',
    } : node.box,
    zIndex: node.zIndex,
    sourceKind,
    ...(style ? { style } : {}),
    ...(content ? { content } : {}),
    ...(parent ? { parentNodeId: parent.nodeId } : {}),
    ...(editableTarget?.elementId ? { elementId: editableTarget.elementId } : {}),
    ...(editableTarget?.creationId ? { creationId: editableTarget.creationId } : {}),
    ...(editableTarget?.elementName ? { elementName: editableTarget.elementName } : {}),
    capabilities: buildNodeToolCapabilities(sourceKind, editableTarget),
    referenceFrame: 'slide',
    diagnostics: [],
    children: [],
  };
  if (node.kind === 'group') {
    summary.children = node.children.map((child) => buildSceneGraphNode(sourceKind, child, slideNumber, summary));
  }
  return summary;
}

function readNodeStyle(node: RenderNode): Record<string, unknown> | undefined {
  if (node.kind === 'shape') {
    return node.fill ? { fill: node.fill } : undefined;
  }
  return undefined;
}

function readNodeContent(node: RenderNode): Record<string, unknown> | undefined {
  if (node.kind === 'text') {
    return { text: node.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(' ') };
  }
  if (node.kind === 'image') {
    return {
      ...(node.alt ? { alt: node.alt } : {}),
      ...(node.fitMode ? { fitMode: node.fitMode } : {}),
      ...(node.borderRadius === 999 ? { rounding: true } : {}),
      ...(typeof node.opacity === 'number' ? { transparency: roundRatio(1 - node.opacity) } : {}),
      ...(typeof node.rotation === 'number' ? { rotation: node.rotation } : {}),
      ...(node.shadow ? { shadow: node.shadow } : {}),
    };
  }
  if (node.kind === 'group') {
    return { childCount: node.children.length };
  }
  return undefined;
}

function buildMinimalFindings(
  renderModel: PresentationRenderModel,
  sourceLocations?: ReadonlyMap<number, {
    readonly file: 'deck.js';
    readonly slideNumber: number;
    readonly startLine: number;
    readonly endLine: number;
  }>,
): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  for (const slide of renderModel.slides) {
    for (const node of slide.elements) {
      if (node.box.x + node.box.w > renderModel.slideSize.width) {
        const slideNumber = slide.index + 1;
        const source = sourceLocations?.get(slideNumber);
        const rightMargin = renderModel.slideSize.width - node.box.x - node.box.w;
        findings.push({
          findingId: `out-of-bounds:${slideNumber}:${node.id}`,
          code: 'out_of_bounds',
          severity: 'warning',
          confidence: 'high',
          slides: [slideNumber],
          evidence: {
            kind: 'node_bounds',
            assessment: 'overflow',
            node: {
              nodeId: node.id,
              kind: node.kind,
              label: node.kind === 'text'
                ? node.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join(' ')
                : node.id,
              finalBox: node.box,
              zIndex: node.zIndex,
            },
            referenceBox: {
              x: 0,
              y: 0,
              w: renderModel.slideSize.width,
              h: renderModel.slideSize.height,
              unit: 'in',
            },
            margins: {
              left: node.box.x,
              right: rightMargin,
              top: node.box.y,
              bottom: renderModel.slideSize.height - node.box.y - node.box.h,
            },
            violatedSides: ['right'],
            thresholdInches: 0,
            policyId: 'slide_bounds',
            fullBleedAxes: [],
          },
          sourceRefs: source ? [{
            kind: 'slide',
            slideNumber,
            locator: source.file,
            startLine: source.startLine,
            endLine: source.endLine,
          }] : [{
            kind: 'unavailable',
            slideNumber,
            nodeId: node.id,
            reason: 'source_location_unavailable',
          }],
          remediation: {
            disposition: 'fix',
            targetNodeIds: [node.id],
            verifyWith: ['inspect', 'render'],
          },
        });
      }
    }
  }
  return findings;
}

function countRenderableNodes(nodes: readonly RenderNode[]): number {
  return nodes.reduce((total, node) => total + 1 + (node.kind === 'group' ? countRenderableNodes(node.children) : 0), 0);
}

function roundInches(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundRatio(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function makeMockCoordinator() {
  const codegenService = makeMockCodegenPresentationService();
  const getRenderModel = vi.fn(async () => makeMockRenderModel());
  const getCodegenPresentationService = vi.fn(() => codegenService);
  const inspectPresentation = vi.fn(async (request: Parameters<PresentationToolCoordinatorPort['inspectPresentation']>[0]) => {
    const renderModel = await getRenderModel(request.presentationId);
    const requestedSlides = renderModel.slides.filter((slide) => {
      const slideNumber = slide.index + 1;
      switch (request.selection.kind) {
        case 'all':
          return true;
        case 'single':
          return slideNumber === request.selection.slideNumber;
        case 'range':
          return slideNumber >= request.selection.fromSlideNumber
            && slideNumber <= request.selection.toSlideNumber;
      }
    });
    const selectedSlides = request.maxSlides === undefined
      ? requestedSlides
      : requestedSlides.slice(0, request.maxSlides);
    const selectedModel: PresentationRenderModel = {
      ...renderModel,
      slides: selectedSlides,
    };
    const sourceLocations = new Map<number, {
      readonly file: 'deck.js';
      readonly slideNumber: number;
      readonly startLine: number;
      readonly endLine: number;
    }>();
    if (selectedModel.sourceKind === 'generated') {
      const structure = await getCodegenPresentationService()
        .structure({ presentation_id: request.presentationId });
      for (const slide of structure.slides) {
        sourceLocations.set(slide.slideNumber, {
          file: 'deck.js',
          slideNumber: slide.slideNumber,
          startLine: slide.startLine,
          endLine: slide.endLine,
        });
      }
    }
    const feedback = buildMinimalToolFeedback(
      request.presentationId,
      'version-id-1',
      selectedModel,
      collectEditableTargetsBySlide(selectedModel),
      undefined,
      { sourceLocations },
    );
    return {
      versionId: 'version-id-1',
      renderModel: selectedModel,
      totalSlideCount: renderModel.slides.length,
      requestedSlideNumbers: requestedSlides.map((slide) => slide.index + 1),
      truncated: selectedSlides.length < requestedSlides.length,
      feedback,
    };
  });

  return {
    createEmptyPresentation: vi.fn(async () => ({ nodeId: 'node-1', versionId: 'v-1' })),
    getRenderModel,
    inspectPresentation,
    directCompose: vi.fn(async () => ({ nodeId: 'node-1', versionId: 'v-1' })),
    edit: vi.fn(async () => ({ versionId: 'v-edit', createdElementIds: [] })),
    export: vi.fn(async () => ({ buffer: Buffer.from('fake-pptx-content'), fileName: 'Test_Deck.pptx' })),
    getSourceKind: vi.fn(async () => 'generated' as const),
    getCodegenPresentationService,
  } satisfies PresentationToolCoordinatorPort & {
    readonly getRenderModel: typeof getRenderModel;
  };
}

function makeContext(coordinator: PresentationToolCoordinatorPort): ToolContext {
  return attachPresentationCoordinatorToToolContext({
    workspaceProjectId: 'project-1',
  }, coordinator);
}

async function expectToolFailure(
  operation: Promise<string>,
  message: RegExp | string,
): Promise<void> {
  await expect(operation).rejects.toThrow(message);
}

function expectInspectDataToBeSlim(data: unknown): void {
  expect(data).toHaveProperty('artifact');
  expect(data).toHaveProperty('document');
  expect(data).toHaveProperty('selection');
  expect(data).toHaveProperty('pages');
  expect(data).not.toHaveProperty('sceneGraph');
  expect(data).not.toHaveProperty('spatialAnalysis');
  expect(data).not.toHaveProperty('findings');
  expect(data).not.toHaveProperty('designTokens');
  expect(data).not.toHaveProperty('pageSummaries');
}

describe('presentationToolClasses', () => {
  it('registers only the codegen-first presentation tool surface', () => {
    expect(createSlidesBackendToolClasses().map((ToolClass) => new ToolClass().name)).toEqual([
      'ppt_plan',
      'ppt_inspect',
      'ppt_export',
    ]);
  });

  it('keeps retired family edit tools out of the production registration surface and manifest', () => {
    const productionNames = new Set(
      createSlidesBackendToolClasses().map((ToolClass) => new ToolClass().name),
    );

    for (const retiredName of RETIRED_SLIDES_EDIT_TOOL_NAMES) {
      expect(productionNames.has(retiredName)).toBe(false);
      expect(slidesToolManifest.allNames).not.toContain(retiredName);
    }
    expect('legacyEditNames' in slidesToolManifest).toBe(false);
  });

  it('让 Slides Agent 只通过既有 Shell 调用 CLI，不恢复插件专属工具', () => {
    expect(slidesToolManifest.agentTools.slidesAgent).toContain('shell');
    expect(slidesToolManifest.agentTools.slidesAgent).toContain('process');
    expect(slidesToolManifest.agentTools.slidesAgent).not.toContain('plugin_command');
  });
});

// ─── PptInspectTool ───────────────────────────────────────────────────────────

describe('PptInspectTool', () => {
  const tool = new PptInspectTool();

  it('has correct name and required params', () => {
    expect(tool.name).toBe('ppt_inspect');
    expect(tool.parameters.required).toEqual([]);
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.parameters.oneOf).toHaveLength(9);
    expect(() => assertToolParameterSchema(tool.parameters)).not.toThrow();
  });

  it('rejects legacy camelCase presentationId arg (hard cut, no alias)', async () => {
    /* docs/27 codegen-first 工具面统一 snake_case；ppt_inspect 之前残留 camelCase
     * 是 P1 扫尾遗漏，硬切之后传旧名应直接报参数缺失，避免 schema drift 留坑。 */
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    await expectToolFailure(
      tool.run({ presentationId: 'pres-1' } as Record<string, unknown>, ctx),
      /Unrecognized key|必须且只能提供一个/i,
    );
  });

  it('returns slim card data and a standardized finding observation', async () => {
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-1' }, ctx);
    const result = JSON.parse(raw);

    expect(result.data.artifact).toEqual({
      presentationId: 'pres-1',
      versionId: 'version-id-1',
      slideCount: 1,
    });
    expect(result.data.document.title).toBe('Test Deck');
    expect(result.data.selection).toEqual({
      requestedSlideNumbers: [1],
      shownSlideNumbers: [1],
      truncated: false,
    });
    expect(result.data.pages).toEqual([{
      slideNumber: 1,
      layoutKey: 'structured',
      elementCount: 2,
      editableTargetCount: 2,
    }]);
    expect(result.data.buildStatus).toEqual({ state: 'ready' });
    expect(result.observationPreviewMeta).toEqual({
      document_name: 'Test Deck',
      doc_type: 'slides/inspection',
    });
    expectInspectDataToBeSlim(result.data);
    expect(result.data.findingSummary).toEqual(expect.objectContaining({
      rawFindingCount: expect.any(Number),
      uniqueFindingCount: expect.any(Number),
    }));
    expect(result.observation).toContain('Slides inspection');
    expect(result.observation).toContain('build=ready');
    expect(result.observation).not.toContain('Quarterly Review');
  });

  it('filters by slideNumber when provided', async () => {
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-1', slideNumber: 1 }, ctx);
    const result = JSON.parse(raw);
    expect(result.data.pages).toHaveLength(1);

    const rawMiss = await tool.run({ presentation_id: 'pres-1', slideNumber: 99 }, ctx);
    const resultMiss = JSON.parse(rawMiss);
    expect(resultMiss.data.pages).toHaveLength(0);
  });

  it('persists only the editable target count in card data', async () => {
    const coordinator = makeMockCoordinator();
    coordinator.getRenderModel.mockResolvedValue({
      presentationId: 'pres-2',
      title: 'Imported Deck',
      version: 2,
      sourceKind: 'patched' as const,
      slideSize: { width: 10, height: 5.625, unit: 'in' as const },
      slides: [
        {
          slideId: 's2',
          index: 0,
          layoutKey: 'imported',
          background: { color: '#FFFFFF' },
          elements: [
            {
              id: 'internal-id',
              kind: 'text' as const,
              box: { x: 1, y: 1, w: 8, h: 1, unit: 'in' as const },
              zIndex: 0,
              visible: true,
              paragraphs: [{ runs: [{ text: 'Hello' }] }],
              editableTarget: {
                slideNumber: 1,
                elementId: 'cid-1',
                creationId: 'c1',
                elementName: 'Title 1',
                operations: ['modify_text'],
              },
            },
          ],
        },
      ],
      capabilities: {
        hasSemanticRender: false,
        hasReferencePreview: false,
        hasHitTest: true,
        hasSelection: true,
      },
    });
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-2' }, ctx);
    const result = JSON.parse(raw);
    expect(result.data.pages[0].editableTargetCount).toBe(1);
    expect(result.data.pages[0].editableTargets).toBeUndefined();
    expectInspectDataToBeSlim(result.data);
  });

  it('does not duplicate source structure in the diagnostic observation', async () => {
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-1' }, ctx);
    const result = JSON.parse(raw);
    expect(result.observation).toContain('Slides inspection');
    expect(result.observation).not.toContain('布局摘要');
    expect(result.observation).not.toContain('关键节点');
    expect(result.observation).not.toContain('可编辑引用');
  });

  it('builds a stable history summary from the strict result', async () => {
    const coordinator = makeMockCoordinator();
    const raw = await tool.run(
      { presentation_id: 'pres-1', slideNumber: 1 },
      makeContext(coordinator),
    );

    expect(tool.getExecutionSummary(raw)).toBe(
      'ppt_inspect：Test Deck（pres-1@version-id-1），已查 1/1 页（1），所查范围 finding 0/0，根因组 0，P0/P1/P2=0/0/0。',
    );
    expect(tool.getExecutionSummary('{"data":{}}')).toBe('ppt_inspect：结果无法解析。');
  });

  it('does not duplicate source-edit element IDs into card data', async () => {
    const inspectTool = new PptInspectTool();
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    const inspectRaw = await inspectTool.run({ presentation_id: 'pres-1' }, ctx);
    const inspectResult = JSON.parse(inspectRaw);
    expect(inspectResult.data.pages[0].editableTargetCount).toBe(2);
    expect(inspectResult.data.pages[0].editableTargets).toBeUndefined();
    expect(inspectResult.data.pages[0].slideTools).toBeUndefined();
  });

  it('returns error when coordinator is missing', async () => {
    await expectToolFailure(tool.run({ presentation_id: 'pres-1' }, {}), /not available/i);
  });

  it('returns error when all target identifiers are missing', async () => {
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    await expectToolFailure(tool.run({}, ctx), /必须且只能提供一个/i);
  });

  it('rejects empty or competing selectors instead of applying compatibility rules', async () => {
    const coordinator = makeMockCoordinator();
    const resolver = vi.fn(async () => ({
      presentationId: 'pres-1',
      path: '/reports/deck.slides',
      inode: 'inode-1',
    }));
    const ctx = attachPresentationInspectTargetResolverToToolContext(
      makeContext(coordinator),
      resolver
    );

    await expectToolFailure(tool.run(
      { presentation_id: '', locator: 'workspace:/reports/deck.slides', inode: '   ' },
      ctx,
    ), /至少包含1个字符|必须且只能提供一个/i);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('builds recursive scene graph entries for group children', async () => {
    const coordinator = makeMockCoordinator();
    const renderModel: PresentationRenderModel = {
      presentationId: 'pres-group',
      title: 'Grouped Deck',
      version: 1,
      sourceKind: 'generated' as const,
      slideSize: { width: 10, height: 5.625, unit: 'in' as const },
      slides: [{
        slideId: 's1',
        index: 0,
        layoutKey: 'freeform',
        background: { color: '#FFFFFF' },
        elements: [{
          id: 's1-freeform-0',
          kind: 'group' as const,
          box: { x: 1, y: 1, w: 4, h: 2, unit: 'in' as const },
          zIndex: 0,
          visible: true,
          children: [{
            id: 's1-freeform-1',
            kind: 'text' as const,
            box: { x: 1.2, y: 1.3, w: 1.8, h: 0.4, unit: 'in' as const },
            zIndex: 1,
            visible: true,
            paragraphs: [{ runs: [{ text: 'Inside group' }] }],
            editableTarget: {
              slideNumber: 1,
              elementId: 's1-freeform-1',
              operations: ['modify_text'],
            },
          }],
        }],
      }],
      capabilities: {
        hasSemanticRender: true,
        hasReferencePreview: false,
        hasHitTest: true,
        hasSelection: true,
      },
    };
    coordinator.getRenderModel.mockResolvedValue(renderModel);
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-group' }, ctx);
    const result = JSON.parse(raw);
    expectInspectDataToBeSlim(result.data);

    const groupNode = buildMinimalToolFeedback('pres-group', '1', renderModel, new Map())
      .sceneGraph[0].rootNode.children[0];
    expect(groupNode.kind).toBe('group');
    expect(groupNode.children).toHaveLength(1);
    expect(groupNode.children[0].parentNodeId).toBe('s1-freeform-0');
    expect(groupNode.children[0].localBox).toEqual({
      x: 0.2,
      y: 0.3,
      w: 1.8,
      h: 0.4,
      unit: 'in',
    });
  });

  it('exposes image visual fields through inspect scene graph summaries', async () => {
    const coordinator = makeMockCoordinator();
    const renderModel: PresentationRenderModel = {
      presentationId: 'pres-image',
      title: 'Image Deck',
      version: 1,
      sourceKind: 'generated' as const,
      slideSize: { width: 10, height: 5.625, unit: 'in' as const },
      slides: [{
        slideId: 's1',
        index: 0,
        layoutKey: 'freeform',
        background: { color: '#FFFFFF' },
        elements: [{
          id: 's1-freeform-0',
          kind: 'image' as const,
          box: { x: 1, y: 1, w: 3, h: 2, unit: 'in' as const },
          zIndex: 0,
          visible: true,
          assetRef: { type: 'external' as const, url: 'https://example.com/hero.png' },
          fitMode: 'cover' as const,
          borderRadius: 999,
          alt: 'Hero image',
          rotation: 12,
          opacity: 0.8,
          shadow: {
            color: '#000000',
            blur: 8,
            offsetX: 0.1,
            offsetY: 0.2,
            opacity: 0.3,
          },
          editableTarget: {
            slideNumber: 1,
            elementId: 's1-freeform-0',
            operations: ['edit_image', 'modify_geometry', 'reorder_layer'],
          },
        }],
      }],
      capabilities: {
        hasSemanticRender: true,
        hasReferencePreview: false,
        hasHitTest: true,
        hasSelection: true,
      },
    };
    coordinator.getRenderModel.mockResolvedValue(renderModel);
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-image' }, ctx);
    const result = JSON.parse(raw);
    expectInspectDataToBeSlim(result.data);

    const imageNode = buildMinimalToolFeedback('pres-image', '1', renderModel, new Map())
      .sceneGraph[0].rootNode.children[0];

    expect(imageNode.content).toMatchObject({
      alt: 'Hero image',
      fitMode: 'cover',
      rounding: true,
      transparency: expect.closeTo(0.2, 5),
      rotation: 12,
      shadow: {
        color: '#000000',
        blur: 8,
        offsetX: 0.1,
        offsetY: 0.2,
        opacity: 0.3,
      },
    });
    expect(imageNode.style).toBeUndefined();
  });

  it('exposes background gradient source semantics in inspect summaries', async () => {
    const coordinator = makeMockCoordinator();
    const renderModel: PresentationRenderModel = {
      presentationId: 'pres-gradient',
      title: 'Gradient Deck',
      version: 1,
      sourceKind: 'generated' as const,
      slideSize: { width: 10, height: 5.625, unit: 'in' as const },
      slides: [{
        slideId: 's1',
        index: 0,
        layoutKey: 'freeform',
        background: {
          color: '#101820',
          imageSrc: 'data:image/svg+xml;base64,AAAA',
          imageFit: 'stretch' as const,
          gradient: {
            source: 'gradient' as const,
            type: 'linear' as const,
            angle: 135,
            stops: [
              { color: '#101820', position: 0 },
              { color: '#2A9D8F', position: 1 },
            ],
          },
        },
        elements: [{
          id: 'gradient-card',
          kind: 'shape' as const,
          box: { x: 1, y: 1, w: 3, h: 1, unit: 'in' as const },
          zIndex: 0,
          visible: true,
          geometry: { type: 'preset', name: 'rect' } as const,
          fill: {
            type: 'gradient' as const,
            gradient: {
              source: 'gradient' as const,
              type: 'linear' as const,
              angle: 45,
              stops: [
                { color: '#0F2747', position: 0 },
                { color: '#F97316', position: 1 },
              ],
            },
          },
        }],
      }],
      capabilities: {
        hasSemanticRender: true,
        hasReferencePreview: false,
        hasHitTest: true,
        hasSelection: true,
      },
    };
    coordinator.getRenderModel.mockResolvedValue(renderModel);
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-gradient' }, ctx);
    const result = JSON.parse(raw);

    expect(result.data.pages[0].background).toBeUndefined();
    expectInspectDataToBeSlim(result.data);
    expect(buildMinimalToolFeedback('pres-gradient', '1', renderModel, new Map())
      .sceneGraph[0].rootNode.children[0].style?.fill).toEqual({
      type: 'gradient',
      gradient: {
        source: 'gradient',
        type: 'linear',
        angle: 45,
        stops: [
          { color: '#0F2747', position: 0 },
          { color: '#F97316', position: 1 },
        ],
      },
    });
  });
});

describe('PptInspectTool diagnostic findings', () => {
  const tool = new PptInspectTool();

  it('20 页整稿必须显式分批，第二批的 P0 不被前十页的零问题掩盖', async () => {
    const coordinator = makeMockCoordinator();
    const base = makeMockRenderModel();
    const slide = base.slides[0];
    if (!slide) throw new Error('Missing fixture slide');
    coordinator.getRenderModel.mockResolvedValue({
      ...base,
      slides: Array.from({ length: 20 }, (_, index) => ({
        ...slide, slideId: `slide-${index + 1}`, index,
        elements: index === 10 ? slide.elements.map((element, elementIndex) => elementIndex === 0
          ? { ...element, box: { x: 9.4, y: 1, w: 1.2, h: 1, unit: 'in' as const } }
          : element) : slide.elements,
      })),
    });
    const context = makeContext(coordinator);
    await expect(tool.run({ presentation_id: 'pres-1' }, context)).rejects.toThrow('PPT_INSPECT_SCOPE_REQUIRED');
    const first = PptInspectToolResultSchema.parse(JSON.parse(await tool.run({
      presentation_id: 'pres-1', slideNumber: 1, endSlide: 10,
    }, context)));
    const second = PptInspectToolResultSchema.parse(JSON.parse(await tool.run({
      presentation_id: 'pres-1', slideNumber: 11, endSlide: 20,
    }, context)));
    expect(first.data.pages).toHaveLength(10);
    expect(second.data.pages).toHaveLength(10);
    expect(first.data.findingSummary.p0Count).toBe(0);
    expect(second.data.findingSummary.p0Count).toBeGreaterThan(0);
    expect(first.observation).toContain('coverage | partial (10/20)');
    expect(second.observation).toContain('remaining pages are unverified');
    expect(first.data.artifact.versionId).toBe(second.data.artifact.versionId);
  });

  it('keeps CLI findings and ppt_inspect summary on the same inspection facts', async () => {
    const coordinator = makeMockCoordinator();
    const baseModel = makeMockRenderModel();
    coordinator.getRenderModel.mockResolvedValue({
      ...baseModel,
      slides: [{
        ...baseModel.slides[0],
        elements: [{
          ...baseModel.slides[0].elements[0],
          box: { x: 9.4, y: 1, w: 1.2, h: 1, unit: 'in' as const },
        }, baseModel.slides[0].elements[1]],
      }],
    });

    const cliResult = await executeSlidesCliCommand({
      kind: 'inspect',
      presentationId: 'pres-1',
      request: { selection: { kind: 'all' }, includeHeuristics: false },
    }, coordinator);
    const toolResult = JSON.parse(await tool.run(
      { presentation_id: 'pres-1' },
      makeContext(coordinator),
    ));
    const cliReport = JSON.parse(cliResult.stdout);
    const finding = cliReport.findings[0];
    const policy = getDiagnosticCodePolicy('out_of_bounds');
    const cliInspectionCall = coordinator.inspectPresentation.mock.results[0];
    const toolInspectionCall = coordinator.inspectPresentation.mock.results[1];
    if (!cliInspectionCall || !toolInspectionCall) {
      throw new Error('Both inspect entries must execute the shared inspection port');
    }
    const cliInspection = await cliInspectionCall.value;
    const toolInspection = await toolInspectionCall.value;
    const sourceFinding = cliInspection.feedback.findings[0];
    if (!sourceFinding) throw new Error('Parity fixture must produce one finding');

    expect(cliResult.exitCode).toBe(SlidesCliExitCode.SUCCESS);
    expect(toolInspection.feedback.findings).toEqual(cliInspection.feedback.findings);
    expect(cliReport.findings).toHaveLength(1);
    expect(finding).toEqual({
      ...sourceFinding,
      action: expect.any(String),
      scope: policy.scope,
      category: policy.category,
      priority: 'P0',
    });
    expect(toolResult.data.findingSummary).toMatchObject({
      rawFindingCount: 1,
      uniqueFindingCount: 1,
      p0Count: 1,
    });
    expect(cliReport.findingSummary).toEqual(toolResult.data.findingSummary);
    expect(cliReport.rootGroups).toEqual([]);
    expect(toolResult.observation).toContain('| out_of_bounds');
    expect(toolResult.observation).toContain('sides=right');
    expect(toolResult.observation).toContain('deck.js:2-9 kind=slide');
  });

  it('returns slim finding stats on every inspect call', async () => {
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-1' }, ctx);
    const result = JSON.parse(raw);

    expect(result.data.artifact.presentationId).toBe('pres-1');
    expect(result.data.pages).toHaveLength(1);
    expect(result.data.buildStatus).toEqual({ state: 'ready' });
    expect(result.data.findingSummary).toEqual(expect.objectContaining({
      rawFindingCount: expect.any(Number),
      uniqueFindingCount: expect.any(Number),
      rootGroupCount: expect.any(Number),
      p0Count: expect.any(Number),
      p1Count: expect.any(Number),
      p2Count: expect.any(Number),
    }));
    expect(result.observationPreviewMeta.doc_type).toBe('slides/inspection');
    expectInspectDataToBeSlim(result.data);
    expect(result.observation).toContain('Slides inspection');
    expect(result.observation).toContain('build=ready');
    expect(tool.getExecutionSummary(raw)).toContain('finding 0/0，根因组 0');
  });

  it('points codegen-ready diagnostics back to deck.js source locations', async () => {
    const coordinator = makeMockCoordinator();
    const baseModel = makeMockRenderModel();
    coordinator.getRenderModel.mockResolvedValueOnce({
      ...baseModel,
      slides: [
        {
          ...baseModel.slides[0],
          elements: [
            {
              ...baseModel.slides[0].elements[0],
              box: { x: 9.4, y: 1, w: 1.2, h: 1, unit: 'in' as const },
            },
            baseModel.slides[0].elements[1],
          ],
        },
      ],
    });
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-1' }, ctx);
    const result = JSON.parse(raw);

    expectInspectDataToBeSlim(result.data);
    expect(result.observation).toContain('deck.js:2-9 kind=slide');
  });

  it('reports editable target counts without persisting target details', async () => {
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-1' }, ctx);
    const result = JSON.parse(raw);

    expect(result.data.pages[0].editableTargetCount).toBe(2);
    expect(result.data.pages[0].editableTargets).toBeUndefined();
  });

  it('accepts heuristics directly without a mode switch', async () => {
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentation_id: 'pres-1', heuristics: true }, ctx);
    const result = JSON.parse(raw);

    expect(result.data.findingSummary).toEqual(expect.objectContaining({
      rawFindingCount: expect.any(Number),
      uniqueFindingCount: expect.any(Number),
    }));
    expect(result.observationPreviewMeta.doc_type).toBe('slides/inspection');
    expect(coordinator.inspectPresentation).toHaveBeenCalledWith(expect.objectContaining({
      includeHeuristics: true,
    }));
  });
});

// ─── PptPlanTool ────────────────────────────────────────────────────────────

describe('PptPlanTool', () => {
  const tool = new PptPlanTool();
  const visualDirection = {
    concept: '克制可信的经营分析风。',
    composition: '高密度证据页与留白结论页交替。',
    signature: '每章使用一次超大结论数字。',
  };

  it('has correct name and required params', () => {
    expect(tool.name).toBe('ppt_plan');
    expect(tool.parameters.required).toEqual(['title', 'visualDirection', 'pages']);
    expect(tool.parameters.additionalProperties).toBe(false);
  });

  it('builds a pages-based plan for review', async () => {
    const raw = await tool.run({
      title: 'Market Entry Plan',
      audience: 'Board',
      visualDirection,
      pages: [
        { title: 'Executive Summary', content: '开场页突出结论摘要，正文用两到三个证据点支撑核心判断。' },
        {
          title: 'Priority Matrix',
          content: '主体是一张 2x2 优先级矩阵，四个象限分别写清标准与代表事项，旁边补一句区域注释说明取舍逻辑。',
        },
        { title: 'Execution Roadmap', content: '用一条时间线串起三段执行路径，每段下面配一个里程碑卡片说明负责人和目标。' },
      ],
    }, {});

    const result = JSON.parse(raw);
    expect(result.data.title).toBe('Market Entry Plan');
    expect(result.data.pageCount).toBe(3);
    expect(result.data.audience).toBe('Board');
    expect(result.data.visualDirection).toEqual(visualDirection);
    expect(result.control).toEqual({
      requireUser: true,
      resumeStrategy: 'continue',
    });
    expect(result.data.pages).toEqual([
      {
        slideNumber: 1,
        title: 'Executive Summary',
        content: '开场页突出结论摘要，正文用两到三个证据点支撑核心判断。',
      },
      {
        slideNumber: 2,
        title: 'Priority Matrix',
        content: '主体是一张 2x2 优先级矩阵，四个象限分别写清标准与代表事项，旁边补一句区域注释说明取舍逻辑。',
      },
      {
        slideNumber: 3,
        title: 'Execution Roadmap',
        content: '用一条时间线串起三段执行路径，每段下面配一个里程碑卡片说明负责人和目标。',
      },
    ]);
    expect(result.observation).toContain('PPT 计划：Market Entry Plan');
    expect(result.observation).toContain('设计理念：克制可信的经营分析风');
    expect(result.observation).toContain('第 2 页：Priority Matrix');
    expect(result.observation).toContain('主要内容：主体是一张 2x2 优先级矩阵');
    expect(result.observation).not.toContain('等待');
    expect(result.observation).not.toContain('暂停');
  });

  it('trims page content instead of failing', async () => {
    const raw = await tool.run({
      title: 'Transformation Story',
      visualDirection,
      pages: [
        { title: 'Overview', content: '  标题页先讲核心结论，再补一句变化原因。  ' },
      ],
    }, {});

    const result = JSON.parse(raw);
    expect(result.data.pageCount).toBe(1);
    expect(result.data.pages).toEqual([
      { slideNumber: 1, title: 'Overview', content: '标题页先讲核心结论，再补一句变化原因。' },
    ]);
  });

  it('returns validation error for malformed pages', async () => {
    await expectToolFailure(tool.run({
      title: 'Broken Outline',
      visualDirection,
      pages: [{ content: 'Missing title' }],
    }, {}), /pages\[0\].*title/i);
  });

  it('requires pages to be non-empty', async () => {
    await expectToolFailure(tool.run({
      title: 'Mismatch',
      visualDirection,
      pages: [],
    }, {}), /pages/i);
  });

  it('reports the actual pages type when pages is an invalid string', async () => {
    await expectToolFailure(tool.run({
      title: 'Mismatch',
      visualDirection,
      pages: 'not-json-array',
    }, {}), /expected a non-empty array of \{title, content\} objects, but received string/i);
  });

  it('getExecutionSummary formats output', () => {
    const summary = tool.getExecutionSummary!(
      JSON.stringify({
        data: {
          title: 'Deck Plan',
          pageCount: 1,
          visualDirection,
          pages: [{ slideNumber: 1, title: 'Overview', content: '说明计划。' }],
        },
      }),
    );
    expect(summary).toContain('Deck Plan');
    expect(summary).toContain('1 页');
  });
});

// ─── PptExportTool ────────────────────────────────────────────────────────────

describe('PptExportTool', () => {
  const tool = new PptExportTool();

  it('has correct name and required params', () => {
    expect(tool.name).toBe('ppt_export');
    expect(tool.parameters.required).toEqual(['presentationId']);
  });

  it('exports a presentation and returns file info', async () => {
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);

    const raw = await tool.run({ presentationId: 'pres-1' }, ctx);
    const result = JSON.parse(raw);

    expect(result.data.presentationId).toBe('pres-1');
    expect(result.data.fileName).toBe('Test_Deck.pptx');
    expect(result.data.sizeBytes).toBeGreaterThan(0);
    expect(result.observation).toContain('Test_Deck.pptx');
    expect(coordinator.export).toHaveBeenCalledWith('pres-1');
  });

  it('returns error when coordinator is missing', async () => {
    await expectToolFailure(tool.run({ presentationId: 'pres-1' }, {}), /not available/i);
  });

  it('returns error when presentationId is missing', async () => {
    const coordinator = makeMockCoordinator();
    const ctx = makeContext(coordinator);
    await expectToolFailure(tool.run({}, ctx), /presentationId/i);
  });

  it('getExecutionSummary formats output', () => {
    const summary = tool.getExecutionSummary!(
      JSON.stringify({ data: { fileName: 'Report.pptx' } }),
    );
    expect(summary).toContain('Report.pptx');
  });
});

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { PptInspectToolResultSchema, type PresentationRenderModel } from '@plugin/slides/shared';
import { resetWorkspaceRootToDefault, setWorkspaceRoot } from 'src/shared/utils/pathManager';
import {
  readToolOutputTextWindowByContext,
  truncateObservationToPreview,
} from 'src/tools/tool_output/toolOutputStore';
import type { DiagnosticFinding } from '../engine/quality/definitions';
import type { DiagnosticToolFeedbackPayload } from '../features/presentationInspection';
import { PptInspectTool } from './PptInspectTool';
import { attachPresentationCoordinatorToToolContext } from './toolContextBinding';
import type {
  CodegenPresentationServicePort,
  PresentationToolCoordinatorPort,
} from './types';

const temporaryRoots: string[] = [];

afterEach(async () => {
  resetWorkspaceRootToDefault();
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

describe('PptInspectTool long inspection observation', () => {
  it('把完整诊断交给通用 ToolOutputStore，并能按 cursor 无损续读', async () => {
    const temporaryRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-ppt-inspect-tool-output-'),
    );
    temporaryRoots.push(temporaryRoot);
    setWorkspaceRoot(temporaryRoot);

    const tool = new PptInspectTool();
    const coordinator = makeLongDiagnosisCoordinator(180);
    const toolContext = attachPresentationCoordinatorToToolContext({
      conversationId: 'conversation-ppt-inspect-long',
      turnId: 'turn-ppt-inspect-long',
      parentToolCallId: ToolCallIdSchema.parse('call-ppt-inspect-long'),
    }, coordinator);
    const result = PptInspectToolResultSchema.parse(JSON.parse(await tool.run({
      presentation_id: 'deck-long',
    }, toolContext)));

    expect(result.observation.length).toBeGreaterThan(20_000);
    expect(result.data.findingSummary).toMatchObject({
      rawFindingCount: 180,
      uniqueFindingCount: 180,
    });

    const preview = await truncateObservationToPreview({
      context: toolContext,
      toolName: tool.name,
      text: result.observation,
      maxChars: 20_000,
      maxLines: 1_200,
      meta: result.observationPreviewMeta,
    });
    expect(preview.truncated).toBe(true);
    if (!preview.truncated) throw new Error('expected long inspection to be truncated');
    expect(preview.preview).toContain('tool_output_read');

    let offset = 0;
    let restored = '';
    while (offset < result.observation.length) {
      const window = await readToolOutputTextWindowByContext({
        context: toolContext,
        blobId: preview.blob_id,
        args: { offset, limit: 9_000 },
      });
      restored += window.windowText;
      if (window.nextOffset === null) break;
      offset = window.nextOffset;
    }
    expect(restored).toBe(result.observation);
  });
});

function makeLongDiagnosisCoordinator(findingCount: number): PresentationToolCoordinatorPort {
  const renderModel: PresentationRenderModel = {
    presentationId: 'deck-long',
    title: '长诊断样本',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 13.333, height: 7.5, unit: 'in' },
    slides: [{
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'consulting',
      background: { color: '#FFFFFF' },
      elements: [],
    }],
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
  const feedback: DiagnosticToolFeedbackPayload = {
    artifact: { presentationId: 'deck-long', versionId: 'version-long', slideCount: 1 },
    pageSummaries: [{
      slideNumber: 1,
      layoutKey: 'consulting',
      elementCount: findingCount,
      background: { color: '#FFFFFF' },
      editableTargets: [],
      slideTools: ['edit_file'],
    }],
    sceneGraph: [],
    spatialAnalysis: [],
    buildStatus: { state: 'ready' },
    findings: Array.from({ length: findingCount }, (_, index) => makeFinding(index)),
  };
  const unsupportedCodegenCall = async (): Promise<never> => {
    throw new Error('Codegen service is outside this inspection test.');
  };
  const codegenService: CodegenPresentationServicePort = {
    read: unsupportedCodegenCall,
    readSourceSlices: unsupportedCodegenCall,
    edit: unsupportedCodegenCall,
    write: unsupportedCodegenCall,
    grep: unsupportedCodegenCall,
    structure: unsupportedCodegenCall,
  };

  return {
    createEmptyPresentation: async () => ({ nodeId: 'deck-long', versionId: 'version-long' }),
    inspectPresentation: async () => ({
      versionId: 'version-long',
      renderModel,
      totalSlideCount: 1,
      requestedSlideNumbers: [1],
      truncated: false,
      feedback,
    }),
    export: async () => ({ buffer: Buffer.from(''), fileName: 'long.pptx' }),
    getSourceKind: async () => 'generated',
    getCodegenPresentationService: () => codegenService,
  };
}

function makeFinding(index: number): DiagnosticFinding {
  const nodeId = `node-${String(index + 1).padStart(3, '0')}`;
  return {
    findingId: `finding-${String(index + 1).padStart(3, '0')}`,
    code: 'out_of_bounds',
    severity: 'warning',
    confidence: 'high',
    slides: [1],
    evidence: {
      kind: 'node_bounds',
      assessment: 'overflow',
      node: {
        nodeId,
        kind: 'text',
        label: `诊断节点 ${index + 1}：用于证明完整 observation 不会被 Slides 私自裁剪`,
        finalBox: { x: 13.1, y: 0.2, w: 1, h: 0.3, unit: 'in' },
        zIndex: index,
      },
      referenceBox: { x: 0, y: 0, w: 13.333, h: 7.5, unit: 'in' },
      margins: { left: 13.1, right: -0.767, top: 0.2, bottom: 7 },
      violatedSides: ['right'],
      thresholdInches: 0,
      policyId: 'slide_bounds',
      fullBleedAxes: [],
    },
    sourceRefs: [{
      precision: 'unavailable',
      slideNumber: 1,
      nodeId,
      reason: 'source_location_unavailable',
    }],
    remediation: {
      disposition: 'fix',
      targetNodeIds: [nodeId],
      verifyWith: ['inspect', 'render'],
    },
  };
}

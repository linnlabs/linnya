import { describe, expect, it, vi } from 'vitest';
import { formatConversationFileLocator } from '@app/schemas/file-locator';
import type {
  PresentationRenderModel,
} from '@plugin/slides/shared';
import type {
  DiagnosticToolFeedbackPayload,
  PresentationInspectionResult,
} from '../../presentationInspection';
import { SlidesScreenshotError } from '../../presentationScreenshot/definitions/presentationScreenshot';
import {
  SlidesCliError,
  SlidesCliExitCode,
  type SlidesCliExecutionPort,
} from '../definitions/slidesCli';
import { executeSlidesCliCommand } from './executeSlidesCliCommand';

function createInspection(): PresentationInspectionResult {
  const renderModel: PresentationRenderModel = {
    presentationId: 'deck-1',
    title: 'Deck',
    version: 7,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: [{
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'cover',
      background: {
        paint: { type: 'none' },
        imageSrc: 'file:///Users/example/private/background.png',
      },
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
    artifact: {
      presentationId: 'deck-1',
      versionId: 'version-uuid-7',
      slideCount: 1,
    },
    pageSummaries: [{
      slideNumber: 1,
      layoutKey: 'cover',
      elementCount: 0,
      background: { imageSrc: 'file:///Users/example/private/background.png' },
      editableTargets: [],
      slideTools: ['edit_file'],
      sourceLocation: {
        file: 'deck.js',
        slideNumber: 1,
        startLine: 2,
        endLine: 8,
      },
    }],
    sceneGraph: [],
    spatialAnalysis: [{
      slideNumber: 1,
      sourceKind: 'generated',
      isEmptySlide: true,
      confidence: 1,
      summaryLines: ['空白页'],
      sections: [],
      relations: [],
      debugLogs: [],
    }],
    buildStatus: { state: 'ready' },
    focus: {
      ranges: [{ startLine: 2, endLine: 8 }],
      nodes: [],
      relations: [],
    },
    findings: [{
      findingId: 'diag:empty_slide:1:slide:0',
      severity: 'info',
      confidence: 'high',
      code: 'empty_slide',
      slides: [1],
      evidence: {
        kind: 'content_presence',
        expectedContent: 'renderable_content',
        inspectedRegion: { x: 0, y: 0, w: 10, h: 5.625, unit: 'in' },
        observedCount: 0,
        triggeringNodeIds: [],
      },
      sourceRefs: [{
        kind: 'slide',
        slideNumber: 1,
        locator: 'deck.js',
        startLine: 2,
        endLine: 8,
      }],
      remediation: {
        disposition: 'review',
        targetNodeIds: [],
        verifyWith: ['render'],
      },
    }],
  };
  return {
    versionId: 'version-uuid-7',
    renderModel,
    totalSlideCount: 1,
    requestedSlideNumbers: [1],
    truncated: false,
    feedback,
  };
}

function createPort(
  inspection: PresentationInspectionResult = createInspection(),
): SlidesCliExecutionPort {
  return {
    renderScreenshots: vi.fn(async () => ({
      presentation: {
        presentationId: 'deck-1',
        title: 'Deck',
        versionId: 'version-uuid-7',
        versionNumber: 7,
        sourceKind: 'generated',
      },
      requestedSlideNumbers: [1],
      slides: [{ slideNumber: 1, relativePath: 'slide-001.jpg' }],
    })),
    inspectPresentation: vi.fn(async () => inspection),
  };
}

describe('executeSlidesCliCommand', () => {
  it('render 成功直接返回版本、页码和 file locator', async () => {
    const result = await executeSlidesCliCommand({
      kind: 'render',
      presentationId: 'deck-1',
      request: {
        selection: { kind: 'all' },
        profile: { id: 'slides-cli-agent-review-v1', viewportWidthPx: 1600, pixelRatio: 1 },
        encoding: { kind: 'agent_review_jpeg' },
        output: { kind: 'directory', root: '/tmp/slides', overwrite: false },
      },
    }, createPort());

    expect(result.exitCode).toBe(SlidesCliExitCode.SUCCESS);
    expect(JSON.parse(result.stdout)).toEqual({
      kind: 'linnya.slides.render-report',
      schemaVersion: 1,
      cliVersion: '1.7.0',
      presentation: {
        id: 'deck-1',
        versionId: 'version-uuid-7',
        versionNumber: 7,
      },
      slides: [{ slideNumber: 1, locator: 'file:///tmp/slides/slide-001.jpg' }],
    });
    expect(result.stderr).toBe('');
  });

  it('受管 render 为每页返回 conversation locator', async () => {
    const result = await executeSlidesCliCommand({
      kind: 'render',
      presentationId: 'deck-1',
      outputDirectoryReference: formatConversationFileLocator(
        'slides-renders/presentation-deck',
      ),
      request: {
        selection: { kind: 'all' },
        profile: { id: 'slides-cli-agent-review-v1', viewportWidthPx: 1600, pixelRatio: 1 },
        encoding: { kind: 'agent_review_jpeg' },
        output: {
          kind: 'latest_version',
          root: '/conversation/slides-renders/presentation-deck',
        },
      },
    }, createPort());

    expect(JSON.parse(result.stdout).slides).toEqual([
      {
        slideNumber: 1,
        locator: 'conversation:/slides-renders/presentation-deck/slide-001.jpg',
      },
    ]);
  });

  it('inspect stdout 是紧凑 finding JSON，且不复制页面结构或背景源路径', async () => {
    const result = await executeSlidesCliCommand({
      kind: 'inspect',
      presentationId: 'deck-1',
      request: {
        selection: { kind: 'all' },
        includeHeuristics: false,
      },
    }, createPort());

    expect(result.exitCode).toBe(SlidesCliExitCode.SUCCESS);
    const report = JSON.parse(result.stdout);
    expect(report.presentation.versionId).toBe('version-uuid-7');
    expect(report.schemaVersion).toBe(7);
    expect(report).not.toHaveProperty('mode');
    expect(report).not.toHaveProperty('pages');
    expect(report.buildStatus).toEqual({ state: 'ready' });
    expect(report.findings[0]).toMatchObject({
      code: 'empty_slide',
      confidence: 'high',
      priority: 'P2',
      evidence: {
        kind: 'content_presence',
        expectedContent: 'renderable_content',
      },
    });
    expect(report.findingSummary).toEqual({
      rawFindingCount: 1,
      uniqueFindingCount: 1,
      rootGroupCount: 0,
      p0Count: 0,
      p1Count: 0,
      p2Count: 1,
    });
    expect(report.rootGroups).toEqual([]);
    expect(report.focus).toEqual({
      ranges: [{ startLine: 2, endLine: 8 }],
      nodes: [],
      relations: [],
    });
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(result.stdout).not.toContain('/Users/example/private');
    expect(result.stderr).toBe('');
  });

  it('未知 inspection 故障使用 internal error，不伪装成 presentation unavailable', async () => {
    const port = createPort();
    port.inspectPresentation = vi.fn(async () => {
      throw new Error('SQLITE_ERROR at /private/workspace.sqlite');
    });
    const result = await executeSlidesCliCommand({
      kind: 'inspect',
      presentationId: 'missing',
      request: { selection: { kind: 'all' }, includeHeuristics: false },
    }, port);

    expect(result.exitCode).toBe(SlidesCliExitCode.INTERNAL_ERROR);
    expect(result.stderr).toBe(
      'slides.cli.internal_error: Slides command failed unexpectedly\n',
    );
    expect(result.stderr).not.toContain('workspace.sqlite');
  });

  it('unresolved draft 保留专用 code、build failure 与文件工具恢复动作', async () => {
    const port = createPort();
    port.inspectPresentation = vi.fn(async () => {
      throw new SlidesCliError(
        'slides.cli.unresolved_draft',
        SlidesCliExitCode.PRESENTATION_UNAVAILABLE,
        'inspect refused the old compiled checkpoint because this deck has an unresolved deck.js draft; build_failure_code=slides.asset.store_unavailable. Use read_file to inspect the pending source, then edit_file or write_file according to that failure.',
      );
    });

    const result = await executeSlidesCliCommand({
      kind: 'inspect',
      presentationId: 'deck-1',
      request: { selection: { kind: 'all' }, includeHeuristics: false },
    }, port);

    expect(result).toEqual({
      exitCode: SlidesCliExitCode.PRESENTATION_UNAVAILABLE,
      stdout: '',
      stderr: 'slides.cli.unresolved_draft: inspect refused the old compiled checkpoint because this deck has an unresolved deck.js draft; build_failure_code=slides.asset.store_unavailable. Use read_file to inspect the pending source, then edit_file or write_file according to that failure.\n',
    });
  });

  it('截图渲染失败返回 render exit code', async () => {
    const port = createPort();
    port.renderScreenshots = vi.fn(async () => {
      throw new SlidesScreenshotError(
        'slides.screenshot.render_failed',
        'Slide render failed',
        1,
      );
    });

    const result = await executeSlidesCliCommand({
      kind: 'render',
      presentationId: 'deck-1',
      request: {
        selection: { kind: 'all' },
        profile: { id: 'slides-cli-agent-review-v1', viewportWidthPx: 1600, pixelRatio: 1 },
        encoding: { kind: 'agent_review_jpeg' },
        output: { kind: 'directory', root: '/tmp/slides', overwrite: false },
      },
    }, port);

    expect(result).toEqual({
      exitCode: SlidesCliExitCode.RENDER_FAILED,
      stdout: '',
      stderr: 'slides.screenshot.render_failed: Slide render failed\n',
    });
  });

  it('输出冲突返回 output exit code', async () => {
    const port = createPort();
    port.renderScreenshots = vi.fn(async () => {
      throw new SlidesScreenshotError(
        'slides.screenshot.output_conflict',
        'Screenshot output already exists',
      );
    });

    const result = await executeSlidesCliCommand({
      kind: 'render',
      presentationId: 'deck-1',
      request: {
        selection: { kind: 'all' },
        profile: { id: 'slides-cli-agent-review-v1', viewportWidthPx: 1600, pixelRatio: 1 },
        encoding: { kind: 'agent_review_jpeg' },
        output: { kind: 'directory', root: '/tmp/slides', overwrite: false },
      },
    }, port);

    expect(result).toEqual({
      exitCode: SlidesCliExitCode.OUTPUT_FAILED,
      stdout: '',
      stderr: 'slides.screenshot.output_conflict: Screenshot output already exists\n',
    });
  });
});

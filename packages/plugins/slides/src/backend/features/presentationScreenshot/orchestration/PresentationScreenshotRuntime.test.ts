import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PresentationRenderModel } from '@plugin/slides/shared';
import type { SlideRasterResult } from '@plugin/slides/shared/slideRasterization';
import { parseSlideRasterRequest } from '@plugin/slides/shared/slideRasterization';
import type {
  PresentationScreenshotRequest,
  PresentationScreenshotSource,
} from '../definitions/presentationScreenshot';
import { PresentationScreenshotRuntime } from './PresentationScreenshotRuntime';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, {
    recursive: true,
    force: true,
  })));
});

function createSource(versionNumber = 7): PresentationScreenshotSource {
  const renderModel: PresentationRenderModel = {
    presentationId: 'deck-1',
    title: 'Quarterly / Review',
    version: versionNumber,
    sourceKind: 'generated',
    slideSize: { width: 1, height: 1, unit: 'in' },
    slides: Array.from({ length: 3 }, (_, index) => ({
      slideId: `slide-${index + 1}`,
      index,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [],
    })),
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
  return {
    identity: {
      presentationId: 'deck-1',
      title: 'Quarterly / Review',
      versionId: `version-${versionNumber}`,
      versionNumber,
      sourceKind: 'generated',
    },
    renderModel,
  };
}

async function createOutputRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slides-screenshot-output-'));
  tempRoots.push(root);
  return root;
}

function createRuntime(input: {
  readonly source?: PresentationScreenshotSource;
  readonly raster?: (slideNumber: number) => SlideRasterResult | Promise<SlideRasterResult>;
} = {}) {
  return new PresentationScreenshotRuntime({
    loadSource: vi.fn(async () => input.source ?? createSource()),
    invokeRasterWorker: async (request) => {
      const slideNumber = Number(request.requestId.split(':').at(-1));
      return await (input.raster ?? successResult)(slideNumber);
    },
    createRunId: () => 'run-1',
  });
}

function successResult(slideNumber: number): SlideRasterResult {
  return {
    status: 'success',
    requestId: `run-1:slide:${slideNumber}`,
    format: 'png',
    widthPx: 1,
    heightPx: 1,
    bytes: PNG_BYTES,
  };
}

function directoryRequest(
  outputRoot: string,
  overwrite = false,
): PresentationScreenshotRequest {
  return {
    presentationId: 'deck-1',
    selection: { kind: 'all' },
    profile: { id: 'ci-v1', viewportWidthPx: 1, pixelRatio: 1 },
    encoding: { kind: 'lossless_png' },
    output: { kind: 'directory', root: outputRoot, overwrite },
  };
}

function managedRequest(
  presentationRoot: string,
  selection: PresentationScreenshotRequest['selection'],
): PresentationScreenshotRequest {
  return {
    presentationId: 'deck-1',
    selection,
    profile: { id: 'agent-review-v1', viewportWidthPx: 1, pixelRatio: 1 },
    encoding: { kind: 'agent_review_jpeg' },
    output: { kind: 'latest_version', root: presentationRoot },
  };
}

describe('PresentationScreenshotRuntime', () => {
  it('对合法极端画布的超预算截图返回专门错误', async () => {
    const source = createSource();
    source.renderModel.slideSize = { width: 1, height: 56, unit: 'in' };
    const outputRoot = await createOutputRoot();

    await expect(createRuntime({ source }).render({
      ...directoryRequest(outputRoot),
      profile: { id: 'default-cli', viewportWidthPx: 1600, pixelRatio: 1 },
    })).rejects.toMatchObject({
      code: 'slides.screenshot.pixel_budget_exceeded',
    });
    expect(await fs.readdir(outputRoot)).toEqual([]);
  });

  it('显式无损入口按范围发布经过复核的 PNG', async () => {
    const outputRoot = await createOutputRoot();
    const result = await createRuntime().render({
      ...directoryRequest(outputRoot),
      selection: { kind: 'range', fromSlideNumber: 2, toSlideNumber: 3 },
    });

    expect(result.slides).toEqual([
      { slideNumber: 2, relativePath: 'slide-002.png' },
      { slideNumber: 3, relativePath: 'slide-003.png' },
    ]);
    expect(await fs.readFile(path.join(outputRoot, 'slide-002.png'))).toEqual(PNG_BYTES);
  });

  it('Agent 检查入口发布真实 JPEG，不改变 hidden raster 的 PNG 合同', async () => {
    const presentationRoot = await createOutputRoot();
    const result = await createRuntime().render(managedRequest(
      presentationRoot,
      { kind: 'single', slideNumber: 1 },
    ));
    const bytes = await fs.readFile(path.join(presentationRoot, result.slides[0].relativePath));

    expect(result.slides[0].relativePath).toMatch(
      /^version-\d{12}-[a-f0-9]{12}\/profile-[a-f0-9]{16}\/slide-001\.jpg$/,
    );
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it('任一页返回坏 PNG 时拒绝整个批次且不发布成功页子集', async () => {
    const outputRoot = await createOutputRoot();
    const runtime = createRuntime({
      raster: (slideNumber) => slideNumber === 2
        ? { ...successResult(2), bytes: new Uint8Array([1, 2, 3]) }
        : successResult(slideNumber),
    });

    await expect(runtime.render(directoryRequest(outputRoot))).rejects.toMatchObject({
      code: 'slides.screenshot.invalid_png',
      slideNumber: 2,
    });
    expect(await fs.readdir(outputRoot)).toEqual([]);
  });

  it('真实 admission 拒绝第 2 页时保留页码和安全字段路径，不发布第 1 页', async () => {
    const outputRoot = await createOutputRoot();
    const source = createSource();
    source.renderModel.slides[1].elements = [{
      id: 'chart', kind: 'chart', chartType: 'line', zIndex: 0,
      box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
      categories: ['A'], palette: ['#4472C4'],
      series: [{ name: 'Rate', values: [1], lineWidth: Number.NaN }],
    }];
    const runtime = new PresentationScreenshotRuntime({
      loadSource: async () => source,
      invokeRasterWorker: async request => {
        const admitted = parseSlideRasterRequest(request);
        return successResult(admitted.slide.index + 1);
      },
      createRunId: () => 'run-1',
    });

    await expect(runtime.render(directoryRequest(outputRoot))).rejects.toMatchObject({
      code: 'slides.screenshot.invalid_request',
      slideNumber: 2,
      message: 'Presentation page raster request was rejected (request.slide.elements[0].series[0])',
    });
    expect(await fs.readdir(outputRoot)).toEqual([]);
  });

  it('显式目录冲突明确失败，overwrite 只替换本次页并保留未知文件', async () => {
    const outputRoot = await createOutputRoot();
    const runtime = createRuntime();
    const request = {
      ...directoryRequest(outputRoot),
      selection: { kind: 'single', slideNumber: 1 } as const,
    };
    await runtime.render(request);
    await fs.writeFile(path.join(outputRoot, 'keep.txt'), 'keep');

    await expect(runtime.render(request)).rejects.toThrow('output already exists');
    await runtime.render({
      ...request,
      output: { kind: 'directory', root: outputRoot, overwrite: true },
    });

    expect(await fs.readFile(path.join(outputRoot, 'keep.txt'), 'utf8')).toBe('keep');
    expect(await fs.readFile(path.join(outputRoot, 'slide-001.png'))).toEqual(PNG_BYTES);
  });

  it('overwrite 在发布失败时恢复旧页，不留下半批次', async () => {
    const outputRoot = await createOutputRoot();
    const runtime = createRuntime();
    const initialRequest = {
      ...directoryRequest(outputRoot),
      selection: { kind: 'single', slideNumber: 1 } as const,
    };
    await runtime.render(initialRequest);
    const oldBytes = await fs.readFile(path.join(outputRoot, 'slide-001.png'));
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (
        String(oldPath).includes('.linnya-screenshot-')
        && !String(oldPath).includes('.backups')
        && String(newPath).endsWith('slide-001.png')
      ) {
        throw new Error('simulated publish failure');
      }
      await rename(oldPath, newPath);
    });

    await expect(runtime.render({
      ...initialRequest,
      output: { kind: 'directory', root: outputRoot, overwrite: true },
    })).rejects.toMatchObject({ code: 'slides.screenshot.output_write_failed' });
    expect(await fs.readFile(path.join(outputRoot, 'slide-001.png'))).toEqual(oldBytes);
  });

  it('同版本局部 render 保留未选择页，新版本局部 render 淘汰整个旧版本', async () => {
    const presentationRoot = await createOutputRoot();
    const version7 = createRuntime({ source: createSource(7) });
    const first = await version7.render(managedRequest(
      presentationRoot,
      { kind: 'single', slideNumber: 1 },
    ));
    const second = await version7.render(managedRequest(
      presentationRoot,
      { kind: 'single', slideNumber: 2 },
    ));
    expect(await fs.access(path.join(presentationRoot, first.slides[0].relativePath)))
      .toBeUndefined();
    expect(await fs.access(path.join(presentationRoot, second.slides[0].relativePath)))
      .toBeUndefined();

    const version8 = createRuntime({ source: createSource(8) });
    const latest = await version8.render(managedRequest(
      presentationRoot,
      { kind: 'single', slideNumber: 3 },
    ));
    await expect(fs.access(path.join(presentationRoot, first.slides[0].relativePath)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.access(path.join(presentationRoot, latest.slides[0].relativePath)))
      .toBeUndefined();
  });

  it('新版本失败时保留旧工作集，旧版本慢任务不能覆盖成功的新版本', async () => {
    const presentationRoot = await createOutputRoot();
    const version7 = createRuntime({ source: createSource(7) });
    const oldResult = await version7.render(managedRequest(
      presentationRoot,
      { kind: 'single', slideNumber: 1 },
    ));
    const brokenVersion8 = createRuntime({
      source: createSource(8),
      raster: () => ({ ...successResult(1), bytes: new Uint8Array([1, 2, 3]) }),
    });
    await expect(brokenVersion8.render(managedRequest(
      presentationRoot,
      { kind: 'single', slideNumber: 1 },
    ))).rejects.toMatchObject({ code: 'slides.screenshot.invalid_png' });
    expect(await fs.access(path.join(presentationRoot, oldResult.slides[0].relativePath)))
      .toBeUndefined();

    await createRuntime({ source: createSource(8) }).render(managedRequest(
      presentationRoot,
      { kind: 'single', slideNumber: 2 },
    ));
    await expect(version7.render(managedRequest(
      presentationRoot,
      { kind: 'single', slideNumber: 3 },
    ))).rejects.toMatchObject({ code: 'slides.screenshot.stale_version' });
    const entries = await fs.readdir(presentationRoot);
    expect(entries.filter((entry) => entry.startsWith('version-'))).toHaveLength(1);
  });
});

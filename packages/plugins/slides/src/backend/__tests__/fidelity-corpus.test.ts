import { readFileSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  flattenSlideElements,
  type FontMetricsProvider,
  type PresentationInfo,
  type PresentationRenderModel,
  type RunAdvanceProvider,
  type SlideElementInfo,
  type TextRenderNode,
  visitRenderNodes,
} from '@plugin/slides/shared';
import { CanonicalBuilder } from '../engine/parser/CanonicalBuilder.js';
import { PptxReader } from '../engine/parser/PptxReader.js';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper.js';
import { PptxValidator } from '../engine/pptx/PptxValidator.js';
import {
  applyTextLayoutToRenderModel,
} from '../engine/text/renderModelTextLayout.js';

const CORPUS_DIR = join(__dirname, 'fixtures', 'fidelity-corpus');

interface FidelityCorpusDeck {
  fileName: string;
  caseNames: readonly string[];
}

const CORPUS_DECKS: readonly FidelityCorpusDeck[] = [
  {
    fileName: 'layout-symbol-breaks.pptx',
    caseNames: [
      'case-pass-at-one-word-wrap',
      'case-currency-pound-word-wrap',
      'case-url-email-boundaries',
      'case-no-wrap-long-token',
    ],
  },
  {
    fileName: 'layout-mixed-runs-cjk.pptx',
    caseNames: [
      'case-mixed-runs-cjk-currency',
      'case-missing-font-latin-fallback',
      'case-cjk-punctuation-stress',
      'case-run-slice-sentinel',
    ],
  },
  {
    fileName: 'layout-autofit-bullets-justify.pptx',
    caseNames: [
      'case-shrink-text-title',
      'case-resize-shape-body',
      'case-justify-alignment',
      'case-multi-level-bullets',
    ],
  },
];

const reader = new PptxReader();
const validator = new PptxValidator();
const canonicalBuilder = new CanonicalBuilder();
const renderModelMapper = new RenderModelMapper();

// M5a 锁的是布局合同自身，不锁某台机器的系统字体文件；真实 OS/2/fontkit 度量由 M4 专项测试负责。
const stableCorpusFontMetricsProvider: FontMetricsProvider = {
  getMetrics() {
    return undefined;
  },
};

// Corpus 要锁定断行规则而不是进程级测量 adapter 的装配状态；每个测试文件使用独立 provider，
// 避免并行测试重置 defaultTextMeasureService 时让同一 fixture 出现不同断点。
const stableCorpusRunAdvanceProvider: RunAdvanceProvider = {
  getClusterAdvances(clusters, style) {
    const emInches = style.fontSizePt / 72;
    const letterSpacingInches = (style.letterSpacingPt ?? 0) / 72;
    return {
      advances: clusters.map((cluster) => (
        emInches * resolveStableCorpusClusterWidth(cluster) + letterSpacingInches
      )),
      source: 'heuristic',
    };
  },
};

function resolveStableCorpusClusterWidth(cluster: string): number {
  if (/^\s$/u.test(cluster)) return 0.32;
  if (/^[\u2E80-\u9FFF\uF900-\uFAFF]$/u.test(cluster)) return 1;
  if (/^[.,:;!?，。？！：；]$/u.test(cluster)) return 0.3;
  if (/^[A-Z0-9@£$]$/u.test(cluster)) return 0.62;
  return 0.52;
}

interface ExpectedLayoutCase {
  lines: readonly string[];
  contentHeightInches: number;
  requiredHeightInches?: number;
  appliedFontScale?: number;
}

const EXPECTED_LAYOUTS: Record<string, Record<string, ExpectedLayoutCase>> = {
  'layout-symbol-breaks.pptx': {
    'case-pass-at-one-word-wrap': {
      contentHeightInches: 1.5625,
      lines: [
        'pass@1 status ',
        'update should ',
        'continue only ',
        'after the ',
        'token ',
        'boundary.',
      ],
    },
    'case-currency-pound-word-wrap': {
      contentHeightInches: 1.302083,
      lines: [
        '£720 due ',
        'before renewal ',
        'should stay ',
        'with the ',
        'amount marker.',
      ],
    },
    'case-url-email-boundaries': {
      contentHeightInches: 0.916667,
      lines: [
        'Contact ops-',
        'team@example.com before ',
        'https://status.example.tes',
        't/pass@1 closes.',
      ],
    },
    'case-no-wrap-long-token': {
      contentHeightInches: 0.21875,
      lines: [
        'NO_WRAP_SENTINEL_pass@1_£720_https://example.test/very-long-token',
      ],
    },
  },
  'layout-mixed-runs-cjk.pptx': {
    'case-mixed-runs-cjk-currency': {
      contentHeightInches: 0.5,
      lines: [
        'Release v2.6：价格£720，然后继续验证中文标',
        '点。不要让，。？！出现在行首。',
      ],
    },
    'case-missing-font-latin-fallback': {
      contentHeightInches: 1.145833,
      lines: [
        'Missing font request: ',
        'FidelityMissingDisplay. The ',
        'resolved font identity should be ',
        'observable and stable enough for ',
        'regression reports.',
      ],
    },
    'case-cjk-punctuation-stress': {
      contentHeightInches: 1,
      lines: [
        '这是一个用于断行压力测试的中文',
        '段落：当宽度变窄时，逗号、句号、问',
        '号和感叹号不应该孤零零跑到行',
        '首。',
      ],
    },
    'case-run-slice-sentinel': {
      contentHeightInches: 0.479167,
      lines: [
        'Plain bold italic 中文 after-run boundary ',
        'keeps slices.',
      ],
    },
  },
  'layout-autofit-bullets-justify.pptx': {
    'case-shrink-text-title': {
      appliedFontScale: 0.75,
      contentHeightInches: 0.445313,
      lines: [
        'A deliberately long title that must shrink ',
        'instead of overflowing its fixed text box',
      ],
    },
    'case-resize-shape-body': {
      contentHeightInches: 0.916667,
      requiredHeightInches: 1.124667,
      lines: [
        'Resize-shape keeps the authored font size ',
        'and expands the box when the generated ',
        'content needs another line. This catches the ',
        '1.0 vs 1.2 line-height split.',
      ],
    },
    'case-justify-alignment': {
      contentHeightInches: 0.916667,
      lines: [
        'Justify alignment should remain semantic ',
        'data even when the renderer chooses not to ',
        'distribute glyphs across the final visual ',
        'line.',
      ],
    },
    'case-multi-level-bullets': {
      contentHeightInches: 1.09375,
      lines: [
        'Contract: padding, wrap, and autofit come ',
        'from one source.',
        'Layout: lines and slices are reused by ',
        'preview.',
        'Export: OOXML keeps the same intent.',
      ],
    },
  },
};

function loadCorpusDeck(fileName: string): Buffer {
  return readFileSync(join(CORPUS_DIR, fileName));
}

async function readSlideXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideEntry = zip.file('ppt/slides/slide1.xml');
  if (slideEntry == null) {
    throw new Error('Expected fidelity corpus deck to contain ppt/slides/slide1.xml');
  }
  return slideEntry.async('text');
}

function requireElement(info: PresentationInfo, name: string): SlideElementInfo {
  const element = flattenSlideElements(info.slides[0]?.elements ?? [])
    .find((candidate) => candidate.name === name);
  if (element == null) {
    throw new Error(`Expected fidelity corpus element: ${name}`);
  }
  return element;
}

async function buildLaidOutRenderModel(fileName: string): Promise<PresentationRenderModel> {
  const info = await reader.parse(loadCorpusDeck(fileName));
  const canonical = canonicalBuilder.build('fidelity-corpus', 1, fileName, info);
  const model = renderModelMapper.fromCanonicalDeck(
    canonical,
    { title: fileName, slides: [] },
    'imported',
  );
  return applyTextLayoutToRenderModel(
    model,
    stableCorpusRunAdvanceProvider,
    stableCorpusFontMetricsProvider,
  );
}

function requireTextNode(model: PresentationRenderModel, elementName: string): TextRenderNode {
  let found: TextRenderNode | undefined;
  for (const slide of model.slides) {
    visitRenderNodes(slide.elements, ({ node }) => {
      if (node.kind === 'text' && node.editableTarget?.elementName === elementName) {
        found = node;
      }
    });
  }
  if (found == null) {
    throw new Error(`Expected laid-out text node: ${elementName}`);
  }
  return found;
}

function readShapeXml(slideXml: string, shapeName: string): string {
  const nameIndex = slideXml.indexOf(`name="${shapeName}"`);
  if (nameIndex < 0) {
    throw new Error(`Expected slide XML shape: ${shapeName}`);
  }

  const shapeStart = slideXml.lastIndexOf('<p:sp>', nameIndex);
  const shapeEnd = slideXml.indexOf('</p:sp>', nameIndex);
  if (shapeStart < 0 || shapeEnd < 0) {
    throw new Error(`Expected complete p:sp XML for shape: ${shapeName}`);
  }

  return slideXml.slice(shapeStart, shapeEnd + '</p:sp>'.length);
}

describe('fidelity corpus fixtures', () => {
  it.each(CORPUS_DECKS)('keeps $fileName readable by validator and reader', async ({ fileName, caseNames }) => {
    const buffer = loadCorpusDeck(fileName);

    const validation = await validator.validate(buffer);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.structure.slideCount).toBe(1);
    expect(validation.structure.slideFiles).toEqual(['ppt/slides/slide1.xml']);

    const info = await reader.parse(buffer);
    expect(info.slideCount).toBe(1);
    const elementNames = flattenSlideElements(info.slides[0]?.elements ?? [])
      .map((element) => element.name);
    expect(elementNames).toEqual(expect.arrayContaining([...caseNames]));
  });

  it('locks symbol boundary and nowrap intent', async () => {
    const buffer = loadCorpusDeck('layout-symbol-breaks.pptx');
    const info = await reader.parse(buffer);

    const passAtOne = requireElement(info, 'case-pass-at-one-word-wrap');
    expect(passAtOne.text).toContain('pass@1');
    expect(passAtOne.textBody?.wrap).toBe('word');
    expect(passAtOne.textBody?.autoFit).toBe('none');

    const currency = requireElement(info, 'case-currency-pound-word-wrap');
    expect(currency.text).toContain('£720');
    expect(currency.textBody?.wrap).toBe('word');

    const noWrap = requireElement(info, 'case-no-wrap-long-token');
    expect(noWrap.text).toContain('NO_WRAP_SENTINEL_pass@1_£720');
    expect(noWrap.textBody?.wrap).toBe('none');
  });

  it('locks mixed runs, missing-font names, and CJK stress cases', async () => {
    const buffer = loadCorpusDeck('layout-mixed-runs-cjk.pptx');
    const info = await reader.parse(buffer);
    const slideXml = await readSlideXml(buffer);

    const mixed = requireElement(info, 'case-mixed-runs-cjk-currency');
    expect(mixed.text).toContain('£720');
    expect(mixed.text).toContain('不要让，。？！出现在行首');
    expect(mixed.textBody?.wrap).toBe('word');

    const mixedXml = readShapeXml(slideXml, 'case-mixed-runs-cjk-currency');
    expect(mixedXml.match(/<a:r>/g)?.length ?? 0).toBeGreaterThan(3);
    expect(mixedXml).toContain('b="1"');

    const missingFont = requireElement(info, 'case-missing-font-latin-fallback');
    expect(missingFont.textStyle?.fontFamily).toBe('FidelityMissingDisplay');

    const cjk = requireElement(info, 'case-cjk-punctuation-stress');
    expect(cjk.textStyle?.fontFamily).toBe('FidelityMissingCjkSans');
    expect(cjk.textBody?.wrap).toBe('word');
  });

  it('locks autofit, justify, and bullet OOXML fields', async () => {
    const buffer = loadCorpusDeck('layout-autofit-bullets-justify.pptx');
    const info = await reader.parse(buffer);
    const slideXml = await readSlideXml(buffer);

    const shrink = requireElement(info, 'case-shrink-text-title');
    expect(shrink.textBody?.autoFit).toBe('shrink-text');
    expect(shrink.textBody?.wrap).toBe('word');

    const resize = requireElement(info, 'case-resize-shape-body');
    expect(resize.textBody?.autoFit).toBe('resize-shape');
    expect(resize.textBody?.wrap).toBe('word');

    const justifyXml = readShapeXml(slideXml, 'case-justify-alignment');
    expect(justifyXml).toContain('algn="just"');

    const bulletsXml = readShapeXml(slideXml, 'case-multi-level-bullets');
    expect(bulletsXml).toContain('<a:buChar char="•"');
    expect(bulletsXml).toContain('<a:buChar char="◦"');
    expect(bulletsXml).toContain('<a:buChar char="▪"');
    const bullets = requireElement(info, 'case-multi-level-bullets');
    expect(bullets.paragraphs).toHaveLength(3);
    expect(bullets.paragraphs?.map((paragraph) => paragraph.runs.map((run) => run.text).join('')))
      .toEqual([
        'Contract: padding, wrap, and autofit come from one source.',
        'Layout: lines and slices are reused by preview.',
        'Export: OOXML keeps the same intent.',
      ]);
  });

  it.each(Object.entries(EXPECTED_LAYOUTS))('locks imported layout output for %s', async (fileName, expectedLayouts) => {
    const model = await buildLaidOutRenderModel(fileName);

    for (const [elementName, expected] of Object.entries(expectedLayouts)) {
      const node = requireTextNode(model, elementName);
      const layout = node.layout;

      expect(layout?.advanceSource).toBe('heuristic');
      expect(layout?.appliedFontScale).toBe(expected.appliedFontScale ?? 1);
      expect(layout?.contentHeightInches).toBeCloseTo(expected.contentHeightInches, 6);
      if (expected.requiredHeightInches == null) {
        expect(layout?.requiredHeightInches).toBeUndefined();
      } else {
        expect(layout?.requiredHeightInches).toBeCloseTo(expected.requiredHeightInches, 6);
      }
      expect(layout?.lines.map((line) =>
        line.slices
          .filter((slice) => slice.isBulletMarker !== true)
          .map((slice) => slice.text)
          .join(''),
      )).toEqual(expected.lines);
    }
  });
});

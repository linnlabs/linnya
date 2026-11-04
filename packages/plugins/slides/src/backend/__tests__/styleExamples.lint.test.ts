import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import {
  buildDeckSpecFromDirectInput,
  compileFlexInput,
  initYoga,
  isFlexComposeInput,
} from '@plugin/slides/backend-codegen';
import { pptComposeProfile, readPptComposeRawPayload } from '@plugin/slides/backend-sandbox';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper';
import { resolveDeckReadingMode } from '@plugin/slides/shared/readingMode';
import { classifyDiagnosticPriority } from '../engine/quality/definitions';
import { collectFindings, evaluateQualityAnalysis } from '../tools/inspectFeedback/diagnostics';
import { buildSceneGraph } from '../tools/inspectFeedback/sceneGraph';

/**
 * 风格页型示例的质量回归：每份示例都要能编译，并且渲染后的排版检查没有 P0 / P1。
 * 示例是写给 Agent 看的“能力示范”，它们自己出现越界、重叠或单字成行，就会把错误做法教给模型。
 */
const EXAMPLES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../resources/skills/slides-design/references/examples',
);
const STYLE_EXAMPLES = ['style-consulting', 'style-catalog', 'style-cultural'] as const;

async function renderExample(stem: string) {
  const source = fs.readFileSync(path.join(EXAMPLES_DIR, `${stem}.js`), 'utf-8');
  return renderSource(stem, source);
}

async function renderSource(stem: string, source: string) {
  const registry = new SandboxProfileRegistry();
  registry.register(pptComposeProfile);
  const sandbox = new SandboxService(registry, createSandboxEvaluatorTestRunner());
  const result = await sandbox.execute({
    profileId: 'ppt_compose',
    language: 'javascript',
    source,
    inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
  });
  if (!result.success) throw new Error(`${stem}.js sandbox execution failed: ${result.error.message}`);
  const payload = readPptComposeRawPayload(result.value);
  if (!payload || !isFlexComposeInput(payload.rawPayload)) throw new Error(`${stem}.js is not a Flex compose payload`);
  await initYoga();
  const compiled = compileFlexInput(payload.rawPayload);
  if (!compiled.input) throw new Error(`${stem}.js compile failed: ${compiled.error ?? 'unknown'}`);
  const deckSpec = buildDeckSpecFromDirectInput(compiled.input);
  const layout = payload.rawPayload.layout;
  const size = typeof layout === 'object' && layout !== null && 'width' in layout
    ? { width: layout.width, height: layout.height }
    : { width: 10, height: 5.625 };
  const model = new RenderModelMapper().fromGeneratedDeck(stem, 1, stem, deckSpec, size);
  const direction = deckSpec.theme?.direction;
  const readingMode = resolveDeckReadingMode('generated', deckSpec.theme);
  const findings = collectFindings(
    evaluateQualityAnalysis(model, { fontTarget: 'office', readingMode, ...(direction ? { direction } : {}) }),
    buildSceneGraph(model),
    [],
  );
  return { model, findings, direction };
}

describe('slides-design 风格页型示例', () => {
  for (const stem of STYLE_EXAMPLES) {
    it(`${stem}.js 编译通过，且渲染后没有 P0 / P1 排版问题`, async () => {
      const { model, findings, direction } = await renderExample(stem);
      expect(model.slides.length).toBeGreaterThanOrEqual(3);
      // 示例示范从 direction 读颜色和字体；声明必须穿过编译进入 DeckSpec，并且全稿贯彻。
      expect(direction?.cardId).toBe('example');
      const blocking = findings
        .map(finding => ({ finding, priority: classifyDiagnosticPriority(finding) }))
        .filter(({ priority }) => priority === 'P0' || priority === 'P1')
        .map(({ finding, priority }) => `${priority} ${finding.code} 第 ${finding.slides.join(',')} 页`);
      expect(blocking, `${stem}.js 有阻断级排版问题`).toEqual([]);
    });
  }

  it('对照：故意越界的源码会被同一条检查标成 P0，说明上面的“没有 P0 / P1”不是空检查', async () => {
    const source = `
      const slide = createSlide({ background: { color: "#FFFFFF" } });
      const t = createText("越界的文字");
      t.position = "absolute";
      t.x = 12.9;
      t.y = 1;
      t.w = 3;
      t.h = 0.5;
      slide.add(t);
      compose({ title: "control", layout: { width: 13.333, height: 7.5, unit: "in" }, slides: [slide] });
    `;
    const { findings } = await renderSource('control', source);
    expect(findings.some(finding => classifyDiagnosticPriority(finding) === 'P0')).toBe(true);
  });
});

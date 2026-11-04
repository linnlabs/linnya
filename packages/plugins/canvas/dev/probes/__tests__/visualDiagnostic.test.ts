import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readCanvasVisualDiagnostic, runCanvasSoftwareLineDiagnostic } from '../visualDiagnostic';

it('固定软件line诊断保留原断言失败及已写采样，不能生成完整suite成功凭证', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'canvas-line-diagnostic-')), failure = new Error('line_dash_is_not_rendered:0:340');
  const writeEvidence = (name: string, facts: unknown) => writeFile(path.join(output, name), JSON.stringify(facts));
  try {
    await expect(runCanvasSoftwareLineDiagnostic({ writeEvidence, async runLine() {
      expect(JSON.parse(await readFile(path.join(output, 'diagnostic-profile.json'), 'utf8')).fullSuite).toBe(false);
      await writeEvidence('line-sampling.json', { declaredDpr: 2, resolution: 1, canvas: { width: 900, height: 600 } });
      throw failure;
    } })).rejects.toBe(failure);
    const evidence = JSON.parse(await readFile(path.join(output, 'diagnostic-failure.json'), 'utf8'));
    expect(evidence.stage).toBe('existing-line-assertions'); expect(evidence.error).toBe(failure.message);
    expect(evidence.fullSuite).toBe(false); expect(evidence.hardwareQualification).toBe(false);
    expect(await readdir(output)).not.toContain('results.json'); expect(await readdir(output)).not.toContain('diagnostic-result.json');
    expect(JSON.parse(await readFile(path.join(output, 'line-sampling.json'), 'utf8')).resolution).toBe(1);
  } finally { await rm(output, { recursive: true, force: true }); }
});

it('局部line原断言成功也明确只保局部报告，不能宣称整个视觉suite或硬件通过', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'canvas-line-only-')); let calls = 0;
  try {
    await runCanvasSoftwareLineDiagnostic({ async runLine() { calls++; return { dashInk: 94, dashGap: 76 }; },
      writeEvidence: (name, facts) => writeFile(path.join(output, name), JSON.stringify(facts)) });
    const result = JSON.parse(await readFile(path.join(output, 'diagnostic-result.json'), 'utf8'));
    expect(calls).toBe(1); expect(result.line).toEqual({ dashInk: 94, dashGap: 76 });
    expect(result.fullSuite).toBe(false); expect(result.hardwareQualification).toBe(false);
    expect(await readdir(output)).not.toContain('results.json');
  } finally { await rm(output, { recursive: true, force: true }); }
});

it('诊断入口拒绝未知表达式或未声明的软件环境，未设置模式仍保完整默认路径', () => {
  expect(readCanvasVisualDiagnostic(undefined, false)).toBeNull();
  expect(readCanvasVisualDiagnostic('software-line', true)).toBe('software-line');
  expect(() => readCanvasVisualDiagnostic('window.anything()', true)).toThrow('visual_diagnostic_mode_unknown');
  expect(() => readCanvasVisualDiagnostic('software-line', false)).toThrow('visual_diagnostic_requires_software');
});

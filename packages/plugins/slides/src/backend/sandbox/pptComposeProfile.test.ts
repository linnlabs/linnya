import { describe, expect, it } from 'vitest';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { pptComposeProfile, readPptComposeRawPayload } from './pptComposeProfile';

function createService(): SandboxService {
  const registry = new SandboxProfileRegistry();
  registry.register(pptComposeProfile);
  return new SandboxService(registry, createSandboxEvaluatorTestRunner());
}

describe('pptComposeProfile', () => {
  it('codegen-source 模式：执行 ppt_compose，并返回场景图 compose 输入', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: `
        console.log('hello from runner');
        const slide = createSlide();
        const title = createText("Hello");
        title.fontSize = 24;
        slide.add(title);
        compose({ title: 'Sandbox Deck', slides: [slide] });
      `,
      inputs: {
        SLIDE_W: 10,
        SLIDE_H: 5.625,
        CHART_PRESETS: ['clean-column'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.logs).toEqual(['hello from runner']);
    const value = readPptComposeRawPayload(result.value);
    expect(value).not.toBeNull();
    expect(value!.rawPayload['title']).toBe('Sandbox Deck');
    expect(value!.composeCallCount).toBe(1);
    expect(value!.layoutTrace).toEqual(expect.objectContaining({
      version: 1,
      truncated: false,
      roots: [1],
    }));
    expect(value!.layoutTrace.nodes).toEqual([
      expect.objectContaining({ id: 1, type: 'Slide' }),
      expect.objectContaining({ id: 2, type: 'Text', content: true }),
    ]);
    expect(result.telemetry.profileId).toBe('ppt_compose');
    expect(result.telemetry.diagnostics.runnerKind).toBe('test-evaluator');
    expect(result.telemetry.diagnostics.startConfirmed).toBe(true);
    expect(result.telemetry.diagnostics.protocolEvents).toContain('started');
  });

  it('未调用 compose() 时返回结构化错误', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: 'const value = 1 + 1; console.log(value);',
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('runtime');
    expect(result.error?.message).toContain('未调用 compose');
  });

  it('语法错误可透传回控制面', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: `const slide = createSlide(; compose({ title: 'x', slides: [slide] });`,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('syntax');
  });

  it('dispatch 前拒绝 profile 白名单外的 capability，不进入 runner', async () => {
    const service = createService();

    await expect(service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: 'console.log("should not run");',
      capabilities: [{ name: 'unknown.capability', maxBytes: 256 * 1024 }],
    })).rejects.toThrow('sandbox.capability.unknown: unknown.capability');
  });

  it('拒绝旧 editPresentation capability，不进入 runner', async () => {
    const service = createService();

    await expect(service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: 'console.log("should not run");',
      capabilities: [{ name: 'host.editPresentation', maxBytes: 256 * 1024 }],
    })).rejects.toThrow('sandbox.capability.unknown: host.editPresentation');
  });

  it('codegen-source 模式：readPptComposeRawPayload 正确读取场景图结果', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: `
        const slide = createSlide();
        compose({ title: 'Test Deck', slides: [slide] });
      `,
      inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
    });

    expect(result.success).toBe(true);
    const value = readPptComposeRawPayload(result.value);
    expect(value).not.toBeNull();
    expect(value!.rawPayload['title']).toBe('Test Deck');
  });

  it('codegen-source 模式公开 createSvgGraphic 并保留源码位置', async () => {
    const service = createService();
    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      profileMode: 'codegen-source',
      source: `
        const slide = createSlide();
        slide.add(createSvgGraphic({
          source: '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="#000"/></svg>',
          width: 4,
          height: 3,
          decorative: true,
        }));
        compose({ title: 'SVG Deck', slides: [slide] });
      `,
      capabilities: [{ name: 'host.compose', maxBytes: 256 * 1024 }],
    });

    expect(result.success).toBe(true);
    const value = readPptComposeRawPayload(result.value);
    expect(value?.rawPayload['slides']).toEqual([
      expect.objectContaining({
        children: [expect.objectContaining({ _type: 'SvgGraphic', decorative: true })],
      }),
    ]);
    expect(value?.layoutTrace.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'SvgGraphic', content: true }),
    ]));
  });

  it('页面内循环创建纯描边 line shape 时仍返回有效布局追踪', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: `
        const slide = createSlide();
        for (let i = 0; i < 2; i += 1) {
          const track = createShape({
            geometry: 'line',
            border: { color: '#334155', width: 1 },
          });
          track.position = 'absolute';
          track.x = 1;
          track.y = 1 + i;
          track.w = 4;
          track.h = 0.1;
          slide.add(track);
        }
        compose({ title: 'Line Trace', slides: [slide] });
      `,
      inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
    });

    expect(result.success).toBe(true);
    const value = readPptComposeRawPayload(result.value);
    expect(value).not.toBeNull();
    expect(value!.layoutTrace.nodes.filter((node) => node.type === 'Shape')).toEqual([
      expect.objectContaining({ content: false }),
      expect.objectContaining({ content: false }),
    ]);
  });

  it('codegen-source 模式：旧 elements 数组格式被拒绝', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: `
        compose({
          title: 'Old Format',
          slides: [{ elements: [] }]
        });
      `,
      inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('runtime');
    expect(result.error?.message).toContain('场景图 DSL');
  });

  it('codegen-source 模式：compose 后 runtime error 不回收', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      profileMode: 'codegen-source',
      source: `
        const slide = createSlide();
        compose({ title: 'Broken Source', slides: [slide] });
        undefinedVar.foo();
      `,
      capabilities: [{ name: 'host.compose', maxBytes: 256 * 1024 }],
      inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('runtime');
    expect(result.warnings).toBeUndefined();
  });

  it('compose 前的 runtime error 不回收（capabilityCalls 为空）', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: `
        undefinedVar.foo();
        compose({ title: 'Never Reached', slides: [] });
      `,
      inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('runtime');
    expect(result.warnings).toBeUndefined();
  });

  it('syntax error 不回收', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      source: `compose({ title: 'x', slides: [ });`,
      inputs: { SLIDE_W: 10, SLIDE_H: 5.625, CHART_PRESETS: [] },
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('syntax');
    expect(result.warnings).toBeUndefined();
  });

  it('拒绝 legacy-edit profileMode', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      profileMode: 'legacy-edit',
      source: `
        const slide = createSlide();
        compose({ title: 'x', slides: [slide] });
      `,
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('policy_denied');
    expect(result.error?.message).toContain('只支持 codegen-source 模式');
    expect(result.telemetry.diagnostics.runnerKind).toBe('not-started');
    expect(result.telemetry.diagnostics.startConfirmed).toBe(false);
  });

  it('codegen-source 模式下 editPresentation 是定制错误 stub', async () => {
    const service = createService();

    const result = await service.execute({
      profileId: 'ppt_compose',
      language: 'javascript',
      profileMode: 'codegen-source',
      source: `editPresentation({ edits: [{ type: 'text_edit', operations: [{}] }] });`,
      capabilities: [{ name: 'host.compose', maxBytes: 256 * 1024 }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('codegen-source 模式下不可用');
    expect(result.error?.message).toContain('read_file / edit_file 修改 deck.js');
  });
});

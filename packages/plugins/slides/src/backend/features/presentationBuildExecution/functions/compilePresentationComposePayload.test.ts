import { describe, expect, it, vi } from 'vitest';
import * as flexLayout from '../../../codegen/compose/flex-layout';

import { compilePresentationComposePayload } from './compilePresentationComposePayload';
import { createInProcessPresentationBuildExecution } from '../infrastructure/inProcessPresentationBuildExecution';
import { readDirectComposeInput } from '../../../codegen/compose/presentationComposeInput';

describe('compilePresentationComposePayload', () => {
  it('正文在 Direct JSON 回读保留空白与局部样式；非法 run 返回字段原因而非成功丢字', async () => {
    const input = { title: 'Text admission', slides: [{ elements: [{
      type: 'text', position: { x: 1, y: 1, w: 4, h: 1 },
      content: [{ text: '  Methods\n', style: { bold: true, color: '#A13456' } }, { text: '' }],
    }] }] };
    const compiled = await compilePresentationComposePayload(input);
    if (!compiled.ok) throw new Error(compiled.message);
    expect(readDirectComposeInput(compiled.input).input?.slides[0].elements[0].content)
      .toEqual(input.slides[0].elements[0].content);
    for (const content of [
      [{ text: 42 }], [{ text: 'Methods', bold: true }],
      [{ text: 'Methods', style: { fontSize: 'large' } }],
      [{ text: 'Methods', style: { unknown: true } }],
      [{ formula: { latex: 'x' } }],
    ]) {
      const rejected = await compilePresentationComposePayload({ ...input, slides: [{ elements: [{
        ...input.slides[0].elements[0], content,
      }] }] });
      expect(rejected).toMatchObject({ ok: false, kind: 'compose_contract' });
      if (rejected.ok) throw new Error('Invalid content must not become a successful blank element');
      expect(rejected.message).toContain('slides[0].elements[0].content[0]');
    }
  });

  it('compiles Flex/Yoga scene graphs into transport-safe direct compose input', async () => {
    const result = await compilePresentationComposePayload({
      title: 'Worker layout',
      slides: [{
        _type: 'Slide',
        children: [{ _type: 'Text', content: 'Hello from Yoga' }],
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      input: {
        title: 'Worker layout',
        slides: [{
          elements: [{ type: 'text', content: 'Hello from Yoga' }],
        }],
      },
    });
    if (result.ok) {
      expect(JSON.stringify(result.input)).not.toContain('undefined');
    }
  });

  it('normalizes valid direct compose input and returns source failures as data', async () => {
    await expect(compilePresentationComposePayload({
      title: 'Direct deck',
      slides: [{ elements: [] }],
    })).resolves.toMatchObject({
      ok: true,
      input: { title: 'Direct deck', slides: [{ elements: [] }] },
    });

    await expect(compilePresentationComposePayload({})).resolves.toMatchObject({
      ok: false,
      kind: 'compose_contract',
    });
  });

  it('整稿中间页失败时返回原页码和字段原因，不提交缩短的成功子集', async () => {
    const validSlide = { _type: 'Slide', children: [{ _type: 'Text', content: 'Valid page' }] };
    const rejected = await compilePresentationComposePayload({
      title: 'Whole deck admission',
      slides: [validSlide, {
        _type: 'Slide',
        children: [{ _type: 'Table', headers: ['name'], rows: [[{ foo: 'invalid' }]] }],
      }, validSlide],
    });

    expect(rejected).toMatchObject({ ok: false, kind: 'compose_contract' });
    if (rejected.ok) throw new Error('A rejected slide must fail the complete deck');
    expect(rejected.message).toContain('第 2 页（slides[1]）');
    expect(rejected.message).toContain('rows/body/data');
    expect(rejected).not.toHaveProperty('input');

    const allRejected = await compilePresentationComposePayload({
      title: 'All pages rejected',
      slides: [
        { _type: 'Slide', children: [{ _type: 'Image' }] },
        { _type: 'Slide', children: [{ _type: 'Table', rows: [[{ foo: 'invalid' }]] }] },
      ],
    });
    if (allRejected.ok) throw new Error('All rejected pages must fail the complete deck');
    expect(allRejected.message).toContain('第 1 页（slides[0]）编译失败：Image');
    expect(allRejected.message).toContain('第 2 页（slides[1]）编译失败：表格');

    const corrected = await compilePresentationComposePayload({
      title: 'Whole deck admission',
      slides: [validSlide, validSlide, validSlide],
    });
    expect(corrected).toMatchObject({ ok: true, input: { slides: [expect.anything(), expect.anything(), expect.anything()] } });
  });

  it('未知 layout 异常不回显内部消息，也不诱导作者随机改稿', async () => {
    const internalError = new Error('Internal runtime failed at /private/runtime/loader.cjs:42');
    const recordRuntimeFailure = vi.fn();
    const execution = createInProcessPresentationBuildExecution({ recordRuntimeFailure });
    const compile = vi.spyOn(flexLayout, 'compileFlexInput').mockImplementation(() => {
      throw internalError;
    });
    try {
      await expect(execution.compileComposePayload({
        title: 'Runtime fault', slides: [{ _type: 'Slide', children: [] }],
      })).resolves.toEqual({
        ok: false,
        kind: 'layout_unavailable',
        message: 'The Slides layout runtime failed. Retry the same source after restoring the runtime.',
      });
      expect(recordRuntimeFailure).toHaveBeenCalledExactlyOnceWith({
        phase: 'compose_layout', slideCount: 1, error: internalError,
      });
    } finally {
      compile.mockRestore();
    }
  });

  it('布局初始化失败同样记录内部原因，但结果只保留安全分类', async () => {
    const internalError = new Error('Internal module loading failure');
    const recordRuntimeFailure = vi.fn();
    const initialize = vi.spyOn(flexLayout, 'initYoga').mockRejectedValue(internalError);
    try {
      await expect(compilePresentationComposePayload({
        title: 'Initialization fault', slides: [{ _type: 'Slide', children: [] }],
      }, { recordRuntimeFailure })).resolves.toEqual({
        ok: false, kind: 'layout_unavailable', message: 'The Slides layout runtime is unavailable.',
      });
      expect(recordRuntimeFailure).toHaveBeenCalledExactlyOnceWith({
        phase: 'layout_initialize', slideCount: 1, error: internalError,
      });
    } finally {
      initialize.mockRestore();
    }
  });

  it('把 Flex 自定义几何的语义错误返回为 compose contract，而不是成功 DTO', async () => {
    const result = await compilePresentationComposePayload({
      title: 'Invalid custom geometry',
      slides: [{
        _type: 'Slide',
        children: [{
          _type: 'Shape',
          width: 2,
          height: 2,
          geometry: {
            type: 'path',
            viewBox: { width: 100, height: 100 },
            commands: [
              { type: 'moveTo', x: 50, y: 50 },
              { type: 'lineTo', x: 50, y: 0 },
              { type: 'cubicTo', x1: 96, y1: 0, x2: 112, y2: 53, x: 82, y: 83 },
              { type: 'close' },
            ],
          },
        }],
      }],
    });

    expect(result).toEqual({
      ok: false,
      kind: 'compose_contract',
      message: 'slides[0].elements[0].geometry.commands[2].control2.x 必须位于 viewBox 内。',
    });
  });
});

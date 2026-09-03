import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectImageGenerationPresentation } from './projectImageGenerationPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput> = {}) {
  return projectImageGenerationPresentation({
    sourceToolName: 'generate_image',
    uiKey: 'generate_image',
    args: { prompt: 'A quiet library', size: '1024x1024', n: 1 },
    result: undefined,
    status: 'loading',
    phase: 'update',
    ...overrides,
  });
}

describe('projectImageGenerationPresentation', () => {
  it('流式生命周期不把参数快照当作 owner admission', () => {
    expect(project({ args: {}, phase: 'start' })).toEqual({ data: { images: [] } });
    expect(project({ args: { pending: true }, phase: 'start' })).toEqual({ data: { images: [] } });
  });

  it('错误与 update 生命周期不读取正式参数或成功结果', () => {
    expect(project({ status: 'error', phase: 'error', result: { invalid: true } })).toEqual({
      data: { images: [] },
    });
    expect(project({ args: {}, phase: 'update' })).toEqual({ data: { images: [] } });
    expect(project({ args: { prompt: 'image', n: 1.5 } })).toEqual({ data: { images: [] } });
  });

  it('成功结果归一化为图片列表并关联尺寸', () => {
    expect(
      project({
        status: 'success',
        phase: 'complete',
        result: {
          data: ['/tmp/a.png', '/tmp/b.png'],
          media: [
            { path: '/tmp/a.png', media_type: 'image/png', width: 1024, height: 768 },
            { path: '/tmp/b.png', media_type: 'image/png', width: 800, height: 600 },
          ],
          observation: 'Generated two images.',
        },
      })
    ).toEqual({
      data: {
        images: [
          { path: '/tmp/a.png', mediaType: 'image/png', width: 1024, height: 768 },
          { path: '/tmp/b.png', mediaType: 'image/png', width: 800, height: 600 },
        ],
      },
    });
  });

  it('历史 text_to_image 事件复用同一严格投影合同', () => {
    expect(project({
      sourceToolName: 'text_to_image',
      uiKey: 'text_to_image',
      status: 'success',
      phase: 'complete',
      result: {
        data: '/tmp/historical.png',
        observation: 'Generated one image.',
      },
    })).toEqual({
      data: { images: [{ path: '/tmp/historical.png' }] },
    });
  });

  it('拒绝 live 与历史工具名交叉匹配', () => {
    expect(() => project({ uiKey: 'text_to_image' })).toThrow(
      'Unsupported image generation presentation',
    );
  });

  it('拒绝开放结果字段和重复 media，但允许 renderer 专用物理路径与 Agent 相对路径分离', () => {
    const result = {
      data: '/tmp/a.png',
      observation: 'Generated one image.',
    };
    expect(() =>
      project({
        status: 'success',
        phase: 'complete',
        result: { ...result, hidden: true },
      })
    ).toThrow();
    expect(() =>
      project({
        status: 'success',
        phase: 'complete',
        result: {
          ...result,
          media: [
            { path: '/tmp/a.png', width: 1, height: 1 },
            { path: '/tmp/a.png', width: 1, height: 1 },
          ],
        },
      })
    ).toThrow('duplicate media identity');
    expect(project({
      status: 'success',
      phase: 'complete',
      result: {
        ...result,
        media: [{ path: '/tmp/conversation/image.png', width: 1, height: 1 }],
      },
    })).toEqual({
      data: {
        images: [{ path: '/tmp/conversation/image.png', width: 1, height: 1 }],
      },
    });
  });
});

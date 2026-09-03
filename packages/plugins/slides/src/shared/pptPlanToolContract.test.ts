import { describe, expect, it } from 'vitest';
import {
  createPptPlanData,
  PptPlanDataSchema,
  PptPlanToolArgsSchema,
} from './pptPlanToolContract';

function makeArgs() {
  return {
    title: '季度经营复盘',
    audience: '管理层',
    visualDirection: {
      concept: '克制、可信的编辑出版风，强调经营判断而不是装饰。',
      composition: '高密度证据页与留白结论页交替，使用清楚的横向阅读路径。',
      signature: '每章只使用一次超大结论数字作为视觉记忆点。',
    },
    pages: [
      { title: '核心结论', content: '用三项关键数据说明本季度的主要经营判断。' },
      { title: '增长来源', content: '用分层图表解释收入增长的主要来源。' },
    ],
  };
}

describe('PptPlanToolArgsSchema', () => {
  it('接纳并归一化内容计划与最小视觉方向', () => {
    expect(PptPlanToolArgsSchema.parse(makeArgs())).toEqual(makeArgs());
  });

  it.each([
    [{ ...makeArgs(), visualDirection: undefined }, 'visualDirection'],
    [{ ...makeArgs(), pageCount: 2 }, 'Unrecognized key'],
    [{ ...makeArgs(), visualDirection: { ...makeArgs().visualDirection, signature: '' } }, 'signature'],
    [{
      ...makeArgs(),
      visualDirection: { ...makeArgs().visualDirection, avoid: '不要使用卡片。' },
    }, 'Unrecognized key'],
  ])('拒绝分叉或不完整的计划合同 %#', (input, message) => {
    expect(() => PptPlanToolArgsSchema.parse(input)).toThrow(message);
  });
});

describe('PptPlanDataSchema', () => {
  it('从参数唯一推导页数与顺序页码', () => {
    const data = createPptPlanData(PptPlanToolArgsSchema.parse(makeArgs()));
    expect(data.pageCount).toBe(2);
    expect(data.pages.map((page) => page.slideNumber)).toEqual([1, 2]);
    expect(data.visualDirection).toEqual(makeArgs().visualDirection);
  });

  it('拒绝页数或页码与 pages 漂移', () => {
    const data = createPptPlanData(PptPlanToolArgsSchema.parse(makeArgs()));
    expect(() => PptPlanDataSchema.parse({ ...data, pageCount: 3 })).toThrow(
      'pageCount 必须与 pages 数量一致',
    );
    expect(() => PptPlanDataSchema.parse({
      ...data,
      pages: data.pages.map((page, index) => ({ ...page, slideNumber: index + 2 })),
    })).toThrow('slideNumber 必须为 1');
  });
});

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

describe('look 的备选配色', () => {
  const palette = { backgrounds: ['#F0F5FC', '#E3E9F4'], ink: '#1A2435', accents: ['#6884AF'] };
  const option = { id: 'plzsjd-1', backgrounds: ['#FAFBF8'], ink: '#1E2117', muted: '#616559', accents: ['#3E4A1F'], chart: ['#5B6939'] };
  const look = { presentation: 'workspace:/储能.slides', palette, paletteId: 'plzsjd-3', fonts: ['DengXian'] };

  it('选定一套的编号和备选配色原样进入计划数据', () => {
    const args = PptPlanToolArgsSchema.parse({ ...makeArgs(), look: { ...look, alternatives: [option] } });
    expect(createPptPlanData(args).look).toEqual({ palette, paletteId: 'plzsjd-3', alternatives: [option], fonts: ['DengXian'] });
  });

  it('不传备选时计划数据里没有这两个字段', () => {
    const args = PptPlanToolArgsSchema.parse({ ...makeArgs(), look: { presentation: look.presentation, palette, fonts: look.fonts } });
    expect(createPptPlanData(args).look).toEqual({ palette, fonts: ['DengXian'] });
  });

  it.each([
    ['空数组', []],
    ['超过 4 套', [option, option, option, option, option]],
    ['未知字段', [{ ...option, name: '浅底' }]],
  ])('拒绝备选配色：%s', (_name, alternatives) => {
    expect(PptPlanToolArgsSchema.safeParse({ ...makeArgs(), look: { ...look, alternatives } }).success).toBe(false);
  });
});

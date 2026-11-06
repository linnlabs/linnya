import { describe, expect, it } from 'vitest';
import type { DirectionDeclaration } from '@plugin/slides/shared/designDirection';
import type { PresentationInfo, SlideElementInfo, SlideInfo } from '@plugin/slides/shared';
import { AestheticLint } from '../AestheticLint.js';
import { lintDirectionCarryThrough } from './directionRules.js';

const DIRECTION: DirectionDeclaration = {
  drawId: 'seed-1',
  cardId: 'risograph',
  palette: {
    backgrounds: ['#F2E6D0', '#1F3B2D'],
    ink: '#1A1A1A',
    accents: ['#E8442E'],
  },
  fonts: ['微软雅黑', 'Georgia'],
};

function text(name: string, family: string, color = '#1A1A1A'): SlideElementInfo {
  return {
    name,
    type: 'text',
    text: '正文',
    textColor: color,
    position: { x: 1, y: 1, w: 4, h: 1 },
    paragraphs: [{ runs: [{ text: '正文', fontFamily: family }] }],
  };
}

function info(slides: SlideInfo[]): PresentationInfo {
  return {
    slideCount: slides.length,
    slideSize: { width: 13.333, height: 7.5 },
    slides,
    theme: { colors: {}, fonts: { major: '', minor: '' } },
    masters: [],
  };
}

const fullBleed = (fill: string, opacity?: number): SlideElementInfo => ({
  name: 'bg',
  type: 'shape',
  fill,
  zIndex: 0,
  ...(opacity != null ? { opacity } : {}),
  position: { x: 0, y: 0, w: 13.333, h: 7.5 },
});

function codes(presentation: PresentationInfo, direction: DirectionDeclaration | undefined = DIRECTION) {
  return lintDirectionCarryThrough(presentation, direction);
}

describe('direction carry-through', () => {
  it('没有声明方向时不检查', () => {
    expect(lintDirectionCarryThrough(info([{ number: 1, elements: [text('t', 'Arial', '#2255CC')] }]), undefined)).toEqual([]);
  });

  it('底色、字体、颜色都在声明里时不报告', () => {
    const issues = codes(info([
      { number: 1, backgroundPaint: { type: 'solid', color: '#F2E6D0' }, elements: [text('t', 'Microsoft YaHei')] },
      { number: 2, elements: [fullBleed('#1F3B2D'), text('t', 'Georgia', '#F2E6D0')] },
      { number: 3, backgroundPaint: { type: 'solid', color: '#F2E6D0' }, elements: [text('t', '微软雅黑', '#B8311F')] },
    ]));
    expect(issues).toEqual([]);
  });

  it('页面回到白底时报告背景偏离，并按观察到的颜色聚合', () => {
    const issues = codes(info([
      { number: 1, backgroundPaint: { type: 'solid', color: '#F2E6D0' }, elements: [] },
      { number: 2, elements: [] },
      { number: 3, backgroundPaint: { type: 'solid', color: '#FFFFFF' }, elements: [] },
    ]));
    expect(issues).toEqual([expect.objectContaining({
      code: 'direction_background_off',
      slides: [2, 3],
      evidence: expect.objectContaining({ aspect: 'background', observed: ['#FFFFFF'], firstAffectedSlide: 2 }),
    })]);
  });

  it('满版形状决定底色；满版照片与背景图不判', () => {
    const issues = codes(info([
      { number: 1, backgroundPaint: { type: 'solid', color: '#FFFFFF' }, elements: [fullBleed('#F2E6D0')] },
      { number: 2, elements: [{ name: 'photo', type: 'image', position: { x: 0, y: 0, w: 13.333, h: 7.5 } }] },
      { number: 3, backgroundImage: true, elements: [] },
      { number: 4, backgroundPaint: { type: 'solid', color: '#F2E6D0' }, elements: [fullBleed('#2255CC', 0.9)] },
    ]));
    expect(issues.filter((issue) => issue.code === 'direction_background_off').map((issue) => issue.slides))
      .toEqual([[4]]);
  });

  it('用了未声明字体时报告，本地化名称算同一款', () => {
    const issues = codes(info([
      { number: 1, backgroundPaint: { type: 'solid', color: '#F2E6D0' }, elements: [text('a', 'Microsoft YaHei'), text('b', 'Consolas')] },
      { number: 2, backgroundPaint: { type: 'solid', color: '#F2E6D0' }, elements: [text('c', 'Consolas')] },
    ]));
    expect(issues).toEqual([expect.objectContaining({
      code: 'direction_font_undeclared',
      slides: [1, 2],
      evidence: expect.objectContaining({ aspect: 'font', observed: ['Consolas'] }),
    })]);
  });

  it('色相离调色板都远的彩色进入复核，同色相深浅不算', () => {
    const issues = codes(info([{
      number: 1,
      backgroundPaint: { type: 'solid', color: '#F2E6D0' },
      elements: [
        { name: 'tint', type: 'shape', fill: '#F7C9C1', position: { x: 1, y: 1, w: 2, h: 1 } },
        { name: 'blue', type: 'shape', fill: '#2255CC', position: { x: 4, y: 1, w: 2, h: 1 } },
      ],
    }]));
    expect(issues).toEqual([expect.objectContaining({
      code: 'direction_color_off_palette',
      slides: [1],
      evidence: expect.objectContaining({ aspect: 'color', observed: ['#2255CC'] }),
    })]);
  });

  it('AestheticLint 通过 options.direction 接入，优先级为背景/字体 P1、颜色 P2 的 warning', () => {
    const report = new AestheticLint().lint(info([{ number: 1, elements: [text('t', 'Arial', '#2255CC')] }]), {
      direction: DIRECTION,
    });
    expect(report.aesthetic.filter((issue) => issue.code.startsWith('direction_')).map((issue) => issue.code).sort())
      .toEqual(['direction_background_off', 'direction_color_off_palette', 'direction_font_undeclared']);
  });
});

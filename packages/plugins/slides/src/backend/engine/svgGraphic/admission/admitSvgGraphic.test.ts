import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SVG_GRAPHIC_ADMISSION_POLICY,
  SvgGraphicAdmissionError,
  type SvgGraphicAdmissionFailureCode,
} from '@plugin/slides/shared/svgGraphic';
import { admitSvgGraphic } from './admitSvgGraphic';

const VALID_DIAGRAM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <title>Flow graphic</title>
  <defs>
    <linearGradient id="nodeFill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1D4ED8"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 Z" fill="#334155"/>
    </marker>
  </defs>
  <g transform="translate(24 36) scale(0.9)">
    <rect x="0" y="0" width="180" height="92" rx="18" fill="url(#nodeFill)"/>
    <path d="M 180 46 C 240 46 270 46 330 46" fill="none" stroke="#334155" stroke-width="4" marker-end="url(#arrow)"/>
    <circle cx="380" cy="46" r="44" fill="#EDE9FE" stroke="#7C3AED" stroke-width="3"/>
  </g>
</svg>`;

describe('admitSvgGraphic', () => {
  it('把无文本 diagram 收敛为可复用的 canonical SVG 事实', () => {
    const report = admitSvgGraphic(VALID_DIAGRAM);

    expect(report.viewBox).toEqual({ width: 640, height: 360 });
    expect(report.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.facts).toEqual({
      hasGradient: true,
      hasMarker: true,
      hasTransform: true,
    });
    expect(report.metrics).toMatchObject({
      elements: 12,
      pathSegments: 6,
      metadataTextLength: 12,
    });
    expect(report.canonicalSvg).not.toContain('\n');
    expect(report.canonicalSvg).not.toContain('<!--');
  });

  it('属性顺序、缩进和注释不改变 canonical bytes 或 content hash', () => {
    const first = admitSvgGraphic(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- x --><rect y="1" width="8" fill="#123456" height="8" x="1"/></svg>`
    );
    const second = admitSvgGraphic(
      `<svg viewBox="0 0 10 10">
        <rect x="1" height="8" fill="#123456" width="8" y="1" />
      </svg>`
    );

    expect(second.canonicalSvg).toBe(first.canonicalSvg);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.canonicalSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it.each([
    {
      name: 'SVG text',
      code: 'slides.svg.unsupported_element' as const,
      source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="1" y="8">label</text></svg>`,
    },
    {
      name: '外部 paint',
      code: 'slides.svg.external_reference_forbidden' as const,
      source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="url(https://example.com/p.svg#x)"/></svg>`,
    },
    {
      name: 'foreignObject',
      code: 'slides.svg.unsupported_element' as const,
      source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject width="10" height="10"/></svg>`,
    },
    {
      name: '事件属性',
      code: 'slides.svg.unsupported_attribute' as const,
      source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" onload="alert(1)"/></svg>`,
    },
    {
      name: 'DOCTYPE',
      code: 'slides.svg.invalid_xml' as const,
      source: `<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>`,
    },
    {
      name: '结束标签中的非法内容',
      code: 'slides.svg.invalid_xml' as const,
      source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"></rect invalid></svg>`,
    },
    {
      name: 'matrix transform',
      code: 'slides.svg.unsupported_attribute' as const,
      source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" transform="matrix(1 0 0 1 0 0)"/></svg>`,
    },
  ])('拒绝 $name，不把危险或跨端不稳定语法静默栅格化', ({ source, code }) => {
    expectAdmissionFailure(source, code);
  });

  it('要求 viewBox 从 0 0 开始且宽高为有限正数', () => {
    expectAdmissionFailure(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`,
      'slides.svg.missing_viewbox'
    );
    expectAdmissionFailure(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 0 10 10"/>`,
      'slides.svg.missing_viewbox'
    );
  });

  it('校验本地 gradient/marker 引用的目标类型与存在性', () => {
    expectAdmissionFailure(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="paint" width="10" height="10" fill="url(#paint)"/></svg>`,
      'slides.svg.external_reference_forbidden'
    );
  });

  it('对 bytes、结构与 metadata 统一执行共享预算', () => {
    expectAdmissionFailure(
      VALID_DIAGRAM,
      'slides.svg.resource_limit_exceeded',
      { ...DEFAULT_SVG_GRAPHIC_ADMISSION_POLICY, maxElements: 3 }
    );
    expectAdmissionFailure(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>abcd</title></svg>`,
      'slides.svg.resource_limit_exceeded',
      { ...DEFAULT_SVG_GRAPHIC_ADMISSION_POLICY, maxMetadataTextLength: 3 }
    );
  });
});

function expectAdmissionFailure(
  source: string,
  code: SvgGraphicAdmissionFailureCode,
  policy = DEFAULT_SVG_GRAPHIC_ADMISSION_POLICY
): void {
  try {
    admitSvgGraphic(source, policy);
  } catch (error) {
    expect(error).toBeInstanceOf(SvgGraphicAdmissionError);
    if (!(error instanceof SvgGraphicAdmissionError)) throw error;
    expect(error.code).toBe(code);
    expect(error.message).not.toContain(source);
    return;
  }
  throw new Error(`Expected SVG admission failure: ${code}`);
}

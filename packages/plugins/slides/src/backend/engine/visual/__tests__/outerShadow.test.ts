import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { createOuterShadowEffectList, normalizePptxShadowAngle, resolveOuterShadow } from '../outerShadow';

function serialize(shadow: Parameters<typeof createOuterShadowEffectList>[1], align?: 'tl'): string {
  const doc = new DOMParser().parseFromString('<root/>', 'application/xml');
  return new XMLSerializer().serializeToString(createOuterShadowEffectList(doc, shadow, align ? { align } : {}));
}

describe('outer shadow conversion', () => {
  it('turns the cartesian offset into a normalized polar form with the default opacity', () => {
    expect(resolveOuterShadow({ color: '#abc', blur: 4, offsetX: 3, offsetY: 4 })).toEqual({
      color: 'AABBCC',
      blur: 4,
      distance: 5,
      angle: 53,
      opacity: 0.3,
    });
    expect(resolveOuterShadow({ color: '#112233', blur: 0, offsetX: 2, offsetY: -2, opacity: 0.6 })).toMatchObject({
      angle: 315,
      opacity: 0.6,
    });
    expect(resolveOuterShadow({ color: '#112233', blur: 0, offsetX: 0, offsetY: 0, opacity: 0 })).toMatchObject({
      distance: 0,
      angle: 0,
      opacity: 0,
    });
  });

  it('rejects colors that are not hex', () => {
    expect(() => resolveOuterShadow({ color: 'red', blur: 1, offsetX: 1, offsetY: 1 })).toThrow('shadow.color');
  });

  it('folds angles into 0-359 whole degrees', () => {
    expect(normalizePptxShadowAngle(-45)).toBe(315);
    expect(normalizePptxShadowAngle(359.6)).toBe(0);
    expect(normalizePptxShadowAngle(90.4)).toBe(90);
  });

  it('writes EMU lengths, 60000ths of a degree and an explicit alpha', () => {
    expect(serialize({ color: '#000000', blur: 8, offsetX: 3, offsetY: 4, opacity: 0.3 })).toBe(
      '<a:effectLst><a:outerShdw blurRad="101600" dist="63500" dir="3180000" rotWithShape="0">'
      + '<a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:outerShdw></a:effectLst>',
    );
    expect(serialize({ color: '#000000', blur: 0, offsetX: 0, offsetY: 2, opacity: 1 }, 'tl')).toBe(
      '<a:effectLst><a:outerShdw blurRad="0" dist="25400" dir="5400000" algn="tl" rotWithShape="0">'
      + '<a:srgbClr val="000000"><a:alpha val="100000"/></a:srgbClr></a:outerShdw></a:effectLst>',
    );
  });
});

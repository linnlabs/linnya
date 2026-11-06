import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { extractImageCrop } from '../parser/xml/ShapeVisualParser';
import type { DeckSpec } from '@plugin/slides/shared';
import { StructuredCompiler } from '../StructuredCompiler';
import { FreeformCompiler } from '../FreeformCompiler';
import {
  readImageDimensions,
  resolvePptxImageFitOptions,
} from './imageSizing';

const TWO_BY_ONE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWP4z8Dwn4EBAAj+Af/KOtJRAAAAAElFTkSuQmCC';

describe('image sizing contract', () => {
  it('reads the dimensions used by the shared fit geometry', () => {
    expect(readImageDimensions({ kind: 'data_uri', dataUri: TWO_BY_ONE_PNG })).toEqual({
      width: 2,
      height: 1,
    });
  });

  it('reads SVG viewBox dimensions without rasterizing the asset', () => {
    const svg = Buffer.from('<svg viewBox="0 0 320 180"><rect width="320" height="180"/></svg>').toString('base64');
    expect(readImageDimensions({
      kind: 'data_uri',
      dataUri: `data:image/svg+xml;base64,${svg}`,
    })).toEqual({ width: 320, height: 180 });
  });

  it('maps cover to a crop rectangle instead of stretching the target box', () => {
    expect(resolvePptxImageFitOptions(
      { x: 1, y: 1, w: 4, h: 4 },
      { kind: 'data_uri', dataUri: TWO_BY_ONE_PNG },
      'cover',
    )).toEqual({
      x: 1,
      y: 1,
      w: 8,
      h: 4,
      sizing: { type: 'crop', x: 2, y: 0, w: 4, h: 4 },
    });
  });

  it('uses a centered image box for contain without a negative source crop', () => {
    expect(resolvePptxImageFitOptions(
      { x: 1, y: 1, w: 4, h: 4 },
      { kind: 'data_uri', dataUri: TWO_BY_ONE_PNG },
      'contain',
    )).toEqual({ x: 1, y: 2, w: 4, h: 2 });
  });

  it.each([
    ['structured', async () => {
      const compiler = new StructuredCompiler();
      const deck: DeckSpec = {
        title: 'structured image fit',
        slides: [{
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [{
              type: 'image',
              src: TWO_BY_ONE_PNG,
              fitMode: 'cover',
              position: { x: 1, y: 1, w: 4, h: 4 },
            }],
          },
        }],
      };
      return compiler.compileDeck(deck);
    }],
    ['freeform', async () => {
      const compiler = new FreeformCompiler();
      const deck: DeckSpec = {
        title: 'freeform image fit',
        slides: [{
          slideNumber: 1,
          spec: {
            type: 'freeform',
            elements: [{
              type: 'image',
              src: TWO_BY_ONE_PNG,
              fitMode: 'cover',
              position: { x: 1, y: 1, w: 4, h: 4 },
            }],
          },
        }],
      };
      return compiler.compileDeck(deck);
    }],
  ] as const)('%s emits the crop geometry consumed by PowerPoint', async (_name, compile) => {
    const zip = await JSZip.loadAsync(await compile());
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(slideXml).toContain('<a:srcRect l="25000" r="25000" t="0" b="0"/>');
    expect(slideXml).toContain('<a:ext cx="3657600" cy="3657600"/>');
    expect(slideXml).not.toContain('<a:srcRect l="0" r="0" t="0" b="0"/>');
  });

  it('does not encode contain as a negative OOXML source crop', async () => {
    const buffer = await new StructuredCompiler().compileDeck({
      title: 'contain image fit',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'image',
            src: TWO_BY_ONE_PNG,
            fitMode: 'contain',
            position: { x: 1, y: 1, w: 4, h: 4 },
          }],
        },
      }],
    });
    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(slideXml).not.toContain('srcRect');
    expect(slideXml).toContain('<a:ext cx="3657600" cy="1828800"/>');
  });
  it('未写 fitMode 时与画布一致按 contain 放置，不拉伸', () => {
    expect(resolvePptxImageFitOptions(
      { x: 1, y: 1, w: 4, h: 4 },
      { kind: 'data_uri', dataUri: TWO_BY_ONE_PNG },
      undefined,
    )).toEqual({ x: 1, y: 2, w: 4, h: 2 });
  });

  it('contain 加裁剪时缩成裁剪区域的比例，并用 source rect 只显示这块区域', () => {
    expect(resolvePptxImageFitOptions(
      { x: 1, y: 1, w: 4, h: 2 },
      { kind: 'data_uri', dataUri: TWO_BY_ONE_PNG },
      'contain',
      { crop: { top: 0, right: 0, bottom: 0, left: 0.5 } },
    )).toEqual({ x: 2, y: 1, w: 4, h: 2, sizing: { type: 'crop', x: 2, y: 0, w: 2, h: 2 } });
  });

  it('stretch 加裁剪不需要读原图尺寸', () => {
    expect(resolvePptxImageFitOptions(
      { x: 1, y: 1, w: 4, h: 4 },
      { kind: 'local_file', path: '/does/not/exist.png' },
      'stretch',
      { crop: { top: 0.25, right: 0, bottom: 0.25, left: 0 } },
    )).toEqual({ x: 1, y: 1, w: 4, h: 8, sizing: { type: 'crop', x: 0, y: 2, w: 4, h: 4 } });
  });

  it.each([
    ['裁剪', { crop: { top: 0, right: 0, bottom: 0, left: 0.5 } }, '<a:srcRect l="50000" r="0" t="0" b="0"/>', { top: 0, right: 0, bottom: 0, left: 0.5 }],
    ['焦点靠左', { focus: { x: 0.05, y: 0.5 } }, '<a:srcRect l="0" r="50000" t="0" b="0"/>', { top: 0, right: 0.5, bottom: 0, left: 0 }],
    ['焦点靠右', { focus: { x: 0.95, y: 0.5 } }, '<a:srcRect l="50000" r="0" t="0" b="0"/>', { top: 0, right: 0, bottom: 0, left: 0.5 }],
  ] as const)('%s写进 PPTX 的 srcRect，并能原样读回', async (_name, framing, expectedXml, expectedCrop) => {
    const buffer = await new FreeformCompiler().compileDeck({
      title: 'image framing',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{
            type: 'image',
            src: TWO_BY_ONE_PNG,
            fitMode: 'cover',
            ...framing,
            position: { x: 1, y: 1, w: 4, h: 4 },
          }],
        },
      }],
    });
    const zip = await JSZip.loadAsync(buffer);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text') ?? '';
    expect(slideXml).toContain(expectedXml);
    expect(slideXml).toContain('<a:ext cx="3657600" cy="3657600"/>');
    const blipFill = new DOMParser().parseFromString(slideXml, 'application/xml').getElementsByTagName('p:blipFill')[0] ?? null;
    expect(extractImageCrop(blipFill)).toEqual(expectedCrop);
  });
});

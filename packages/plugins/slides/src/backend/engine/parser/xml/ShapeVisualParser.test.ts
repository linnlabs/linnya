import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { extractImageCrop, extractImageFitMode, extractShapeVisual } from './ShapeVisualParser';

describe('ShapeVisualParser custom geometry', () => {
  it('回读 move/line/quadratic/cubic/close typed path', () => {
    const doc = new DOMParser().parseFromString(`
      <p:spPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:custGeom>
          <a:pathLst><a:path w="100" h="80">
            <a:moveTo><a:pt x="0" y="80"/></a:moveTo>
            <a:lnTo><a:pt x="20" y="10"/></a:lnTo>
            <a:quadBezTo><a:pt x="35" y="0"/><a:pt x="50" y="20"/></a:quadBezTo>
            <a:cubicBezTo><a:pt x="60" y="40"/><a:pt x="80" y="0"/><a:pt x="100" y="80"/></a:cubicBezTo>
            <a:close/>
          </a:path></a:pathLst>
        </a:custGeom>
      </p:spPr>
    `, 'application/xml');
    const visual = extractShapeVisual(doc.documentElement).visual;
    expect(visual?.geometry).toEqual({
      type: 'path',
      viewBox: { width: 100, height: 80 },
      commands: [
        { type: 'moveTo', x: 0, y: 80 },
        { type: 'lineTo', x: 20, y: 10 },
        { type: 'quadraticTo', x1: 35, y1: 0, x: 50, y: 20 },
        { type: 'cubicTo', x1: 60, y1: 40, x2: 80, y2: 0, x: 100, y: 80 },
        { type: 'close' },
      ],
      closed: true,
    });
  });

  it('多 path 的外部 custom geometry 不伪装成首条路径', () => {
    const doc = new DOMParser().parseFromString(`
      <p:spPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:custGeom><a:pathLst>
          <a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="10" y="10"/></a:lnTo><a:close/></a:path>
          <a:path w="10" h="10"><a:moveTo><a:pt x="0" y="10"/></a:moveTo><a:lnTo><a:pt x="10" y="0"/></a:lnTo><a:close/></a:path>
        </a:pathLst></a:custGeom>
      </p:spPr>
    `, 'application/xml');
    expect(extractShapeVisual(doc.documentElement).visual?.geometry).toBeUndefined();
  });

  it('回读 PPTX 的 srcRect 为原样裁剪，再按 stretch 撑满 frame', () => {
    const doc = new DOMParser().parseFromString(`
      <p:blipFill xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        <a:srcRect l="25000" r="25000" t="0" b="0"/>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
    `, 'application/xml');
    expect(extractImageFitMode(doc.documentElement)).toBe('stretch');
    expect(extractImageCrop(doc.documentElement)).toEqual({ top: 0, right: 0.25, bottom: 0, left: 0.25 });
  });

  it('srcRect 全零或只有负值时不视为裁剪', () => {
    const parse = (rect: string) => new DOMParser().parseFromString(`
      <p:blipFill xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        ${rect}
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
    `, 'application/xml').documentElement;
    expect(extractImageCrop(parse('<a:srcRect/>'))).toBeUndefined();
    expect(extractImageCrop(parse('<a:srcRect l="-10000" r="-10000"/>'))).toBeUndefined();
    expect(extractImageCrop(parse('<a:srcRect t="12500" b="-5000"/>'))).toEqual({ top: 0.125, right: 0, bottom: 0, left: 0 });
  });
});

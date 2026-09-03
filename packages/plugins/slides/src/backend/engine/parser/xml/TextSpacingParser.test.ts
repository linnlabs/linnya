import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { getElementByTag } from './XmlNode.js';
import { parseLineSpacing } from './TextSpacingParser.js';

function parseParagraphProps(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return getElementByTag(doc, 'a:pPr');
}

describe('TextSpacingParser', () => {
  it('keeps spcPct as multiple line spacing', () => {
    const pPr = parseParagraphProps(`
      <a:pPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:lnSpc><a:spcPct val="125000"/></a:lnSpc>
      </a:pPr>
    `);

    expect(parseLineSpacing(pPr)).toEqual({ kind: 'multiple', value: 1.25 });
  });

  it('keeps spcPts as exact point line spacing', () => {
    const pPr = parseParagraphProps(`
      <a:pPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:lnSpc><a:spcPts val="1800"/></a:lnSpc>
      </a:pPr>
    `);

    expect(parseLineSpacing(pPr)).toEqual({ kind: 'exactPt', value: 18 });
  });
});

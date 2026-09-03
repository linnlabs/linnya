import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { parseSlideElements } from './SlideElementParser';

const theme = { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } };

describe('SlideElementParser OOXML order', () => {
  it('preserves picture and shape z-order instead of regrouping by element kind', () => {
    const doc = new DOMParser().parseFromString(`
      <p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r">
        <p:cSld><p:spTree>
          <p:pic>
            <p:nvPicPr><p:cNvPr id="1" name="Picture first"/></p:nvPicPr>
            <p:blipFill><a:blip r:embed="rId1"/><a:stretch/></p:blipFill>
            <p:spPr/>
          </p:pic>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="2" name="Text second"/><p:cNvSpPr txBox="1"/></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>second</a:t></a:r></a:p></p:txBody>
            <p:spPr/>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sld>
    `, 'application/xml');

    const elements = parseSlideElements(
      doc,
      new Map([['rId1', '../media/image1.png']]),
      theme,
    );
    expect(elements.map(element => element.name)).toEqual(['Picture first', 'Text second']);
    expect(elements.map(element => element.type)).toEqual(['image', 'text']);
  });
});

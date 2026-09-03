import type JSZip from 'jszip';
import {
  DOMParser,
  Element as XmlElement,
  XMLSerializer,
  type Document as XmlDocument,
} from '@xmldom/xmldom';
import type { ThemeSpec } from '@plugin/slides/shared';

const GENERATED_THEME_PATH = 'ppt/theme/theme1.xml';

/**
 * PptxGenJS 4 只把 head/body 写进 a:latin，导致同一个 theme run 的中文继续落到
 * Office 默认 Hans 字体。这里在唯一 package 后处理入口补齐同一份声明语义。
 */
export async function applyDeclaredThemeFonts(
  zip: JSZip,
  fonts: NonNullable<ThemeSpec['fonts']> | undefined,
): Promise<boolean> {
  if (fonts == null) return false;
  const themeFile = zip.file(GENERATED_THEME_PATH);
  if (themeFile == null) {
    throw new Error(`Generated PPTX is missing ${GENERATED_THEME_PATH}`);
  }

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const document = parser.parseFromString(await themeFile.async('text'), 'application/xml');
  const majorFont = firstElement(document, 'a:majorFont');
  const minorFont = firstElement(document, 'a:minorFont');
  if (majorFont == null || minorFont == null) {
    throw new Error('Generated PPTX theme is missing majorFont/minorFont');
  }

  const majorChanged = applyFontSet(majorFont, fonts.major);
  const minorChanged = applyFontSet(minorFont, fonts.minor);
  if (!majorChanged && !minorChanged) return false;
  zip.file(GENERATED_THEME_PATH, serializer.serializeToString(document));
  return true;
}

function applyFontSet(fontSet: XmlElement, family: string): boolean {
  const latin = requiredDirectChild(fontSet, 'a:latin');
  const eastAsian = requiredDirectChild(fontSet, 'a:ea');
  const complex = requiredDirectChild(fontSet, 'a:cs');
  const simplifiedChinese = directChildren(fontSet).find((element) => (
    element.tagName === 'a:font' && element.getAttribute('script') === 'Hans'
  ));
  if (simplifiedChinese == null) {
    throw new Error('Generated PPTX theme is missing the Hans font mapping');
  }

  return [latin, eastAsian, complex, simplifiedChinese]
    .map((element) => setTypeface(element, family))
    .some(Boolean);
}

function setTypeface(element: XmlElement, family: string): boolean {
  if (element.getAttribute('typeface') === family) return false;
  element.setAttribute('typeface', family);
  return true;
}

function firstElement(document: XmlDocument, tagName: string): XmlElement | null {
  const element = document.getElementsByTagName(tagName).item(0);
  return element instanceof XmlElement ? element : null;
}

function requiredDirectChild(parent: XmlElement, tagName: string): XmlElement {
  const child = directChildren(parent).find((element) => element.tagName === tagName);
  if (child == null) {
    throw new Error(`Generated PPTX theme is missing ${tagName}`);
  }
  return child;
}

function directChildren(parent: XmlElement): XmlElement[] {
  const children: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child instanceof XmlElement) children.push(child);
  }
  return children;
}

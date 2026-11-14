import type JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const SLIDE_PART = /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/u;
const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/u;
// 汉字（含扩展 A、兼容汉字、扩展 B 以后）与全角标点、CJK 标点。
const HAN_OR_CJK_PUNCTUATION = /[　-〿㐀-䶿一-鿿豈-﫿︰-﹏＀-･\u{20000}-\u{3134F}]/u;

/**
 * PptxGenJS 把每个 run 都写成 `lang="en-US"`。PowerPoint 只对标成东亚语言的 run 执行避头尾，
 * 于是中文的句号、逗号会落到行首，与预览不一致（2026-11-13 用 PowerPoint 导 PDF 实测：只改
 * `lang` 即恢复避头尾，单加 `eaLnBrk` 无效）。这里按 run 的实际文字改成 zh-CN / ja-JP / ko-KR，
 * 保留 `altLang="en-US"` 给其中的西文；只改 PptxGenJS 写的默认值，不覆盖其他语言。
 */
export async function applyEastAsianRunLanguage(zip: JSZip): Promise<boolean> {
  let mutated = false;
  for (const path of Object.keys(zip.files).filter((file) => SLIDE_PART.test(file))) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async('text');
    if (!HAN_OR_CJK_PUNCTUATION.test(xml) && !HANGUL.test(xml) && !KANA.test(xml)) continue;
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    let changed = false;
    for (const run of Array.from(doc.getElementsByTagName('a:r'))) {
      const properties = run.getElementsByTagName('a:rPr')[0];
      if (!properties || properties.getAttribute('lang') !== 'en-US') continue;
      const text = Array.from(run.getElementsByTagName('a:t')).map((node) => node.textContent ?? '').join('');
      const language = resolveEastAsianLanguage(text);
      if (!language) continue;
      properties.setAttribute('lang', language);
      if (!properties.hasAttribute('altLang')) properties.setAttribute('altLang', 'en-US');
      changed = true;
    }
    if (!changed) continue;
    zip.file(path, new XMLSerializer().serializeToString(doc));
    mutated = true;
  }
  return mutated;
}

export function resolveEastAsianLanguage(text: string): 'zh-CN' | 'ja-JP' | 'ko-KR' | undefined {
  if (HANGUL.test(text)) return 'ko-KR';
  if (KANA.test(text)) return 'ja-JP';
  if (HAN_OR_CJK_PUNCTUATION.test(text)) return 'zh-CN';
  return undefined;
}

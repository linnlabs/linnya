/**
 * TextBodyParser
 *
 * 把 OOXML `p:txBody` 翻译为 ai-ppt 的 `SlideElementTextBodyInfo / SlideElementParagraphInfo / SlideElementTextStyleInfo`。
 * 单位严格按 ai-ppt §4.4 / §4.5 文本契约：
 * - bodyPr 内 padding：英寸（OOXML 默认 EMU → emuToInches）
 * - paragraph 段间距：pt
 * - paragraph 行距：保留 OOXML multiple / exactPt 语义，不再汇总到 element textStyle
 */

import type { Element as XmlElement } from '@xmldom/xmldom';
import type {
  SlideElementParagraphInfo,
  SlideElementTextBodyInfo,
  SlideElementTextRunInfo,
  SlideElementTextStyleInfo,
  ThemeInfo,
} from '@plugin/slides/shared';
import { emuToInches } from '@plugin/backend/textMeasurement';
import {
  classifyDominantScript,
  collectRequiredGlyphCodePoints,
  resolveFont,
} from '@plugin/backend/fontResolution';
import {
  directChildren,
  getAttr,
  getElementByTag,
  getTextContent,
  parseBooleanAttr,
} from './XmlNode.js';
import {
  extractMaxFontSizePt,
  parseLineSpacing,
  parseSpacingPoints,
  resolveRunFontFamily,
} from './TextSpacingParser.js';

/**
 * 提取 `a:bodyPr` 中的容器层级文本属性：wrap / autoFit / verticalAlign / padding。
 *
 * OOXML 规范默认 padding：`tIns/bIns = 45720 EMU (0.05")`，`lIns/rIns = 91440 EMU (0.1")`。
 */
export function extractTextBodyInfo(txBody: XmlElement): SlideElementTextBodyInfo | undefined {
  const bodyPr = getElementByTag(txBody, 'a:bodyPr');
  if (!bodyPr) {
    return undefined;
  }

  const padding = {
    top: emuToInches(Number(getAttr(bodyPr, 'tIns') ?? '45720')),
    right: emuToInches(Number(getAttr(bodyPr, 'rIns') ?? '91440')),
    bottom: emuToInches(Number(getAttr(bodyPr, 'bIns') ?? '45720')),
    left: emuToInches(Number(getAttr(bodyPr, 'lIns') ?? '91440')),
  };
  const hasPadding = Object.values(padding).some((value) => value > 0);
  const wrapAttr = getAttr(bodyPr, 'wrap');
  const anchorAttr = getAttr(bodyPr, 'anchor');

  let autoFit: SlideElementTextBodyInfo['autoFit'];
  if (getElementByTag(bodyPr, 'a:normAutofit')) {
    autoFit = 'shrink-text';
  } else if (getElementByTag(bodyPr, 'a:spAutoFit')) {
    autoFit = 'resize-shape';
  } else if (getElementByTag(bodyPr, 'a:noAutofit')) {
    autoFit = 'none';
  }

  return {
    wrap: wrapAttr === 'none' ? 'none' : wrapAttr != null ? 'word' : undefined,
    autoFit,
    verticalAlign: anchorAttr === 'ctr'
      ? 'middle'
      : anchorAttr === 'b'
        ? 'bottom'
        : anchorAttr != null
          ? 'top'
          : undefined,
    padding: hasPadding ? padding : undefined,
  };
}

/**
 * 提取每段的段前 / 段后间距与缩进。
 * spcBef / spcAft 同时支持 `a:spcPts` 与 `a:spcPct`（后者按段最大字号换算到 pt）。
 */
export function extractParagraphInfo(
  txBody: XmlElement,
  theme: ThemeInfo,
): SlideElementParagraphInfo[] | undefined {
  const txBodyMaxFontPt = extractMaxFontSizePt(txBody);
  const textBodyDefaultRunProps = getElementByTag(txBody, 'a:defRPr');
  const listStyle = getElementByTag(txBody, 'a:lstStyle');
  const paragraphs = directChildren(txBody, 'a:p').map(
    (paragraph): SlideElementParagraphInfo => {
      const paragraphProps = getElementByTag(paragraph, 'a:pPr');
      const explicitLineSpacing = parseLineSpacing(paragraphProps);
      const listLineSpacing = explicitLineSpacing == null
        ? resolveListStyleLineSpacing(listStyle, paragraphProps)
        : undefined;
      const paragraphDefaultRunProps = paragraphProps
        ? getElementByTag(paragraphProps, 'a:defRPr')
        : null;
      const indentRaw = Number(getAttr(paragraphProps ?? paragraph, 'indent'));
      // 优先用段内 run 字号，缺失时退到 txBody 级最大字号，仍然缺失时再 fallback 给 spcPts 唯一可解析的写法
      const paragraphFontPt = extractMaxFontSizePt(paragraph) ?? txBodyMaxFontPt;
      return {
        runs: extractParagraphRuns(
          paragraph,
          paragraphDefaultRunProps,
          textBodyDefaultRunProps,
          theme,
        ),
        align: parseParagraphAlign(getAttr(paragraphProps ?? paragraph, 'algn')),
        spacingBeforePt: parseSpacingPoints(
          getElementByTag(paragraphProps ?? paragraph, 'a:spcBef'),
          paragraphFontPt,
        ),
        spacingAfterPt: parseSpacingPoints(
          getElementByTag(paragraphProps ?? paragraph, 'a:spcAft'),
          paragraphFontPt,
        ),
        lineSpacing: explicitLineSpacing ?? listLineSpacing,
        lineSpacingResolution: explicitLineSpacing
          ? { source: 'paragraph' }
          : listLineSpacing
            ? { source: 'list-style' }
            : { source: 'unresolved', reason: 'layout-master-context-unavailable' },
        indentInches: Number.isFinite(indentRaw) ? emuToInches(indentRaw) : undefined,
      };
    },
  );
  return paragraphs.length > 0 ? paragraphs : undefined;
}

function resolveListStyleLineSpacing(
  listStyle: XmlElement | null,
  paragraphProps: XmlElement | null,
): SlideElementParagraphInfo['lineSpacing'] {
  if (!listStyle) return undefined;
  const levelRaw = Number(paragraphProps ? getAttr(paragraphProps, 'lvl') : null);
  const level = Number.isInteger(levelRaw) && levelRaw >= 0 && levelRaw <= 8 ? levelRaw + 1 : 1;
  return parseLineSpacing(getElementByTag(listStyle, `a:lvl${level}pPr`));
}

function parseParagraphAlign(value: string | null): SlideElementParagraphInfo['align'] {
  switch (value) {
    case 'ctr': return 'center';
    case 'r': return 'right';
    case 'just':
    case 'dist': return 'justify';
    case 'l': return 'left';
    default: return undefined;
  }
}

function extractParagraphRuns(
  paragraph: XmlElement,
  paragraphDefaultRunProps: XmlElement | null,
  textBodyDefaultRunProps: XmlElement | null,
  theme: ThemeInfo,
): SlideElementTextRunInfo[] {
  const runs: SlideElementTextRunInfo[] = [];
  const inherited = resolveRunInfo(
    '',
    null,
    paragraphDefaultRunProps,
    textBodyDefaultRunProps,
    theme,
  );

  for (let index = 0; index < paragraph.childNodes.length; index += 1) {
    const child = paragraph.childNodes.item(index);
    if (!child || child.nodeType !== 1) continue;
    const element = child as XmlElement;
    if (element.tagName === 'a:r' || element.tagName === 'a:fld') {
      runs.push(resolveRunInfo(
        getTextContent(element, 'a:t'),
        getElementByTag(element, 'a:rPr'),
        paragraphDefaultRunProps,
        textBodyDefaultRunProps,
        theme,
      ));
      continue;
    }
    if (element.tagName === 'a:br') {
      runs.push(resolveRunInfo(
        '\n',
        getElementByTag(element, 'a:rPr'),
        paragraphDefaultRunProps,
        textBodyDefaultRunProps,
        theme,
      ));
    }
  }

  return runs.length > 0 ? runs : [inherited];
}

function resolveRunInfo(
  text: string,
  runProps: XmlElement | null,
  paragraphDefaultRunProps: XmlElement | null,
  textBodyDefaultRunProps: XmlElement | null,
  theme: ThemeInfo,
): SlideElementTextRunInfo {
  const fontFamily = resolveRunFontFamily(
    runProps,
    resolveRunFontFamily(
      paragraphDefaultRunProps,
      resolveRunFontFamily(textBodyDefaultRunProps, theme.fonts.minor),
    ),
  );
  const bold = readInheritedBoolean('b', runProps, paragraphDefaultRunProps, textBodyDefaultRunProps);
  const italic = readInheritedBoolean('i', runProps, paragraphDefaultRunProps, textBodyDefaultRunProps);
  const fontScript = classifyDominantScript(text);
  const resolvedFont = fontFamily == null
    ? undefined
    : resolveFont({
        family: fontFamily,
        bold: bold === true,
        italic: italic === true,
        script: fontScript,
        requiredCodePoints: collectRequiredGlyphCodePoints(text),
      });
  return {
    text,
    fontFamily,
    resolvedFontFamily: resolvedFont?.resolvedFamily,
    fontScript,
    fontResolution: resolvedFont?.resolution,
    fontFaceFingerprint: resolvedFont?.resolved?.faceFingerprint,
    resolvedBold: resolvedFont?.resolved?.bold,
    resolvedItalic: resolvedFont?.resolved?.italic,
    fontSize: readInheritedFontSize(runProps, paragraphDefaultRunProps, textBodyDefaultRunProps),
    bold,
    italic,
  };
}

function readInheritedFontSize(...runProps: Array<XmlElement | null>): number | undefined {
  for (const props of runProps) {
    if (!props) continue;
    const raw = Number(getAttr(props, 'sz'));
    if (Number.isFinite(raw) && raw > 0) return raw / 100;
  }
  return undefined;
}

function readInheritedBoolean(
  attribute: 'b' | 'i',
  ...runProps: Array<XmlElement | null>
): boolean | undefined {
  for (const props of runProps) {
    if (!props) continue;
    const value = parseBooleanAttr(getAttr(props, attribute));
    if (value != null) return value;
  }
  return undefined;
}

/**
 * 汇总 txBody 内 run 的字体 / 字号 / 粗斜，给只需要概要的质量链路使用。
 * 行距只属于 ordered paragraphs，禁止再在元素样式上广播。
 * 主类传入 `theme` 用于 fallback 字体（minor / major font）。
 */
export function extractTextStyleInfo(
  txBody: XmlElement,
  theme: ThemeInfo,
): SlideElementTextStyleInfo | undefined {
  const paragraphNodes = directChildren(txBody, 'a:p');
  const defaultRunProps = getElementByTag(txBody, 'a:defRPr');
  let maxFontSize = extractMaxFontSizePt(txBody);
  let fontFamily = resolveRunFontFamily(defaultRunProps, theme.fonts.minor);
  let bold = parseBooleanAttr(defaultRunProps ? getAttr(defaultRunProps, 'b') : null);
  let italic = parseBooleanAttr(defaultRunProps ? getAttr(defaultRunProps, 'i') : null);

  for (const paragraph of paragraphNodes) {
    const runNodes = paragraph.getElementsByTagName('a:r');
    for (let i = 0; i < runNodes.length; i++) {
      const run = runNodes.item(i) as XmlElement;
      const runProps = getElementByTag(run, 'a:rPr');
      if (!runProps) {
        continue;
      }
      const size = Number(getAttr(runProps, 'sz'));
      if (Number.isFinite(size) && size > 0) {
        maxFontSize = Math.max(maxFontSize ?? 0, size / 100);
      }
      fontFamily = resolveRunFontFamily(runProps, fontFamily);
      bold = bold ?? parseBooleanAttr(getAttr(runProps, 'b'));
      italic = italic ?? parseBooleanAttr(getAttr(runProps, 'i'));
    }
  }

  if (
    maxFontSize == null
    && fontFamily == null
    && bold == null
    && italic == null
  ) {
    return undefined;
  }

  return {
    fontFamily,
    fontSize: maxFontSize,
    bold,
    italic,
  };
}

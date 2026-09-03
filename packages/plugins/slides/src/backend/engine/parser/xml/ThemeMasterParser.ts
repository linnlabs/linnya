/**
 * ThemeMasterParser
 *
 * 解析 PPT 的 theme（颜色 / 字体）与 master / layout 名称。
 *
 * 与文件系统 / 解压器解耦：通过 `readXml` 函数注入「path → XmlDocument」能力，
 * 主类把 JSZip + DOMParser 实例闭包成 readXml 后传进来，本模块不直接依赖任何 IO。
 */

import type { Document as XmlDocument } from '@xmldom/xmldom';
import { resolveThemeChartPalette } from '@plugin/slides/shared';
import type { MasterInfo, ThemeInfo } from '@plugin/slides/shared';
import { buildRelMap, getAttr, getElementByTag } from './XmlNode.js';

/** 注入式的 XML 读取能力。返回 null 表示文件不存在。 */
export type ReadXml = (path: string) => Promise<XmlDocument | null>;

/**
 * 解析 deck 默认 theme：优先按 master 顺序找，找不到时退到 `ppt/theme/theme1.xml`，
 * 最后再退到内置 Calibri 默认。
 */
export async function parseTheme(
  readXml: ReadXml,
  relMap: Map<string, string>,
): Promise<ThemeInfo> {
  const masterPaths = resolveMasterPaths(relMap);

  for (const masterPath of masterPaths) {
    const themeDoc = await readThemeFromMaster(readXml, masterPath);
    if (themeDoc) {
      return extractThemeInfo(themeDoc);
    }
  }

  const defaultTheme = await readXml('ppt/theme/theme1.xml');
  if (defaultTheme) {
    return extractThemeInfo(defaultTheme);
  }

  return {
    colors: {},
    fonts: { major: 'Calibri Light', minor: 'Calibri' },
    chart: { palette: resolveThemeChartPalette() },
  };
}

/** 把 themeDoc 转换为 ThemeInfo（含 chart palette 解析）。 */
export function extractThemeInfo(themeDoc: XmlDocument): ThemeInfo {
  const name = extractThemeName(themeDoc);
  const colors = extractThemeColors(themeDoc);
  const fonts = extractThemeFonts(themeDoc);
  return {
    name,
    colors,
    fonts,
    chart: { palette: resolveThemeChartPalette({ colors }) },
  };
}

/** 从 presentation rels 里挑出 slideMaster 路径列表。 */
export function resolveMasterPaths(relMap: Map<string, string>): string[] {
  const paths: string[] = [];
  for (const [, target] of relMap) {
    if (!target.includes('slideMaster')) continue;
    paths.push(target.startsWith('/') ? target.substring(1) : `ppt/${target}`);
  }
  return paths;
}

/** 从某个 master 的 rels 中找到关联 theme 文档（master ↔ theme 通常 1:1）。 */
export async function readThemeFromMaster(
  readXml: ReadXml,
  masterPath: string,
): Promise<XmlDocument | null> {
  const masterFileName = masterPath.split('/').pop();
  if (!masterFileName) return null;

  const masterRelsPath = `ppt/slideMasters/_rels/${masterFileName}.rels`;
  const masterRels = await readXml(masterRelsPath);
  if (!masterRels) return null;

  const relMap = buildRelMap(masterRels);
  for (const [, target] of relMap) {
    if (!target.includes('theme')) continue;
    const themePath = target.startsWith('../')
      ? `ppt/${target.replace('../', '')}`
      : `ppt/slideMasters/${target}`;
    const themeDoc = await readXml(themePath);
    if (themeDoc) return themeDoc;
  }

  return null;
}

/** 取 `a:theme@name`，缺失返回 undefined。 */
export function extractThemeName(themeDoc: XmlDocument): string | undefined {
  const themeEl = getElementByTag(themeDoc, 'a:theme');
  return themeEl ? getAttr(themeEl, 'name') ?? undefined : undefined;
}

/**
 * 提取 theme 调色盘（dk1/lt1/accent1..6/hlink/folHlink）。
 * 颜色既可能是 `srgbClr`，也可能是 `sysClr`，后者通常带 `lastClr` 作为最近一次解析值。
 */
export function extractThemeColors(themeDoc: XmlDocument): Record<string, string> {
  const colors: Record<string, string> = {};
  const clrScheme = getElementByTag(themeDoc, 'a:clrScheme');
  if (!clrScheme) return colors;

  const colorNames = [
    'dk1', 'dk2', 'lt1', 'lt2',
    'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
    'hlink', 'folHlink',
  ];

  for (const colorName of colorNames) {
    const colorEl = getElementByTag(clrScheme, `a:${colorName}`);
    if (!colorEl) continue;

    const srgbClr = getElementByTag(colorEl, 'a:srgbClr');
    if (srgbClr) {
      const val = getAttr(srgbClr, 'val');
      if (val) colors[colorName] = `#${val}`;
      continue;
    }

    const sysClr = getElementByTag(colorEl, 'a:sysClr');
    if (sysClr) {
      const lastClr = getAttr(sysClr, 'lastClr');
      if (lastClr) colors[colorName] = `#${lastClr}`;
    }
  }

  return colors;
}

/** 提取 theme 主次字体（majorFont = 标题字体，minorFont = 正文字体）。 */
export function extractThemeFonts(themeDoc: XmlDocument): { major: string; minor: string } {
  const fontScheme = getElementByTag(themeDoc, 'a:fontScheme');
  let major = 'Calibri Light';
  let minor = 'Calibri';

  if (fontScheme) {
    const majorFont = getElementByTag(fontScheme, 'a:majorFont');
    const minorFont = getElementByTag(fontScheme, 'a:minorFont');

    if (majorFont) {
      const latin = getElementByTag(majorFont, 'a:latin');
      if (latin) {
        const typeface = getAttr(latin, 'typeface');
        if (typeface) major = typeface;
      }
    }

    if (minorFont) {
      const latin = getElementByTag(minorFont, 'a:latin');
      if (latin) {
        const typeface = getAttr(latin, 'typeface');
        if (typeface) minor = typeface;
      }
    }
  }

  return { major, minor };
}

/** 把 deck 里的全部 slideMaster + 它们各自的 layout 名称汇总成 MasterInfo[]。 */
export async function parseMasters(
  readXml: ReadXml,
  relMap: Map<string, string>,
): Promise<MasterInfo[]> {
  const masters: MasterInfo[] = [];

  for (const [, target] of relMap) {
    if (target.includes('slideMaster')) {
      const masterPath = target.startsWith('/') ? target.substring(1) : `ppt/${target}`;
      const masterDoc = await readXml(masterPath);
      if (!masterDoc) continue;

      const cSld = getElementByTag(masterDoc, 'p:cSld');
      const name = cSld ? getAttr(cSld, 'name') ?? '' : '';

      const masterFileName = masterPath.split('/').pop();
      const masterRelsPath = `ppt/slideMasters/_rels/${masterFileName}.rels`;
      const masterRels = await readXml(masterRelsPath);
      const layouts = await extractLayoutNames(readXml, masterRels);

      masters.push({
        name: name || `Master ${masters.length + 1}`,
        layouts,
      });
    }
  }

  return masters;
}

/** 从 master rels 里提取所有 slideLayout 的显示名。 */
export async function extractLayoutNames(
  readXml: ReadXml,
  masterRels: XmlDocument | null,
): Promise<string[]> {
  const layouts: string[] = [];
  if (!masterRels) return layouts;

  const relMap = buildRelMap(masterRels);
  for (const [, target] of relMap) {
    if (target.includes('slideLayout')) {
      const layoutPath = target.startsWith('../')
        ? `ppt/${target.replace('../', '')}`
        : `ppt/slideMasters/${target}`;
      const layoutDoc = await readXml(layoutPath);
      if (!layoutDoc) continue;

      const cSld = getElementByTag(layoutDoc, 'p:cSld');
      const name = cSld ? getAttr(cSld, 'name') : null;
      if (name) layouts.push(name);
    }
  }

  return layouts;
}

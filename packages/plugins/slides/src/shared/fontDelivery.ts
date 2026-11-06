import type { TextFontScript } from './textFontIdentity';

/**
 * 文稿字体面向的放映环境。
 * - `office`：Windows 与 Mac 上的 PowerPoint，生成稿默认值；
 * - `local`：只在当前这台电脑上放映，任何已安装字体都可交付。
 */
export type FontDeliveryTarget = 'office' | 'local';

export const DEFAULT_FONT_DELIVERY_TARGET: FontDeliveryTarget = 'office';

/**
 * 字体在目标环境中的可交付程度。
 * - `core`：Windows 自带或随 Office 安装，Mac 系统或 Mac 版 PowerPoint 也自带；
 * - `cloud`：Microsoft 365 / Office 2021 及以上首次打开时联网下载（Office 云字体），
 *   旧版或离线 Office 会替换；
 * - `unavailable`：目标环境没有，打开时会被替换并重新断行。
 */
export type FontDeliveryStatus = 'core' | 'cloud' | 'unavailable';

export interface OfficeFontFamily {
  /** PPTX 中写入的规范 family 名。 */
  readonly family: string;
  /** 中文系统常见的本地化名称，同样能被 PowerPoint 识别。 */
  readonly localNames: readonly string[];
  readonly script: TextFontScript;
  readonly status: Exclude<FontDeliveryStatus, 'unavailable'>;
}

function office(
  family: string,
  script: TextFontScript,
  status: OfficeFontFamily['status'] = 'core',
  localNames: readonly string[] = [],
): OfficeFontFamily {
  return { family, localNames, script, status };
}

/**
 * Office 通用字体表。核对来源（2026-11-03）：
 * - Windows 10/11 默认字体与 Office for Windows 随附字体；
 * - Mac 版 PowerPoint 安装包 `Contents/Resources/DFonts` 与 macOS 系统字体；
 * - Microsoft 支持文档“Cloud fonts in Office”的中文、日文、韩文清单。
 * 只收录两端都能直接打开（core）或 Office 云字体能补齐（cloud）的 family；
 * Segoe UI、Bahnschrift 等 Mac 没有的 Windows 字体，以及 PingFang SC 等 Mac 专属字体不在表内。
 */
export const OFFICE_FONT_FAMILIES: readonly OfficeFontFamily[] = Object.freeze([
  office('Arial', 'latin'),
  office('Arial Black', 'latin'),
  office('Calibri', 'latin'),
  office('Cambria', 'latin'),
  office('Candara', 'latin'),
  office('Century Gothic', 'latin'),
  office('Comic Sans MS', 'latin'),
  office('Consolas', 'latin'),
  office('Constantia', 'latin'),
  office('Corbel', 'latin'),
  office('Courier New', 'latin'),
  office('Franklin Gothic Medium', 'latin'),
  office('Franklin Gothic Book', 'latin'),
  office('Garamond', 'latin'),
  office('Georgia', 'latin'),
  office('Gill Sans MT', 'latin'),
  office('Book Antiqua', 'latin'),
  office('Bookman Old Style', 'latin'),
  office('Century Schoolbook', 'latin'),
  office('Impact', 'latin'),
  office('Lucida Console', 'latin'),
  office('Palatino Linotype', 'latin'),
  office('Perpetua', 'latin'),
  office('Rockwell', 'latin'),
  office('Tahoma', 'latin'),
  office('Times New Roman', 'latin'),
  office('Trebuchet MS', 'latin'),
  office('Tw Cen MT', 'latin'),
  office('Verdana', 'latin'),
  office('Aptos', 'latin', 'cloud'),

  office('Microsoft YaHei', 'eastAsian', 'core', ['微软雅黑']),
  office('DengXian', 'eastAsian', 'core', ['等线']),
  office('SimSun', 'eastAsian', 'core', ['宋体']),
  office('NSimSun', 'eastAsian', 'core', ['新宋体']),
  office('SimHei', 'eastAsian', 'core', ['黑体']),
  office('KaiTi', 'eastAsian', 'core', ['楷体']),
  office('FangSong', 'eastAsian', 'core', ['仿宋']),
  office('Microsoft JhengHei', 'eastAsian', 'core', ['微軟正黑體']),
  office('MingLiU', 'eastAsian', 'core', ['細明體']),
  office('PMingLiU', 'eastAsian', 'core', ['新細明體']),
  office('Yu Gothic', 'eastAsian', 'core', ['游ゴシック']),
  office('Yu Mincho', 'eastAsian', 'core', ['游明朝']),
  office('Meiryo', 'eastAsian', 'core', ['メイリオ']),
  office('MS Gothic', 'eastAsian', 'core', ['ＭＳ ゴシック']),
  office('MS Mincho', 'eastAsian', 'core', ['ＭＳ 明朝']),
  office('Malgun Gothic', 'eastAsian', 'core', ['맑은 고딕']),
  office('Batang', 'eastAsian', 'core', ['바탕']),
  office('Gulim', 'eastAsian', 'core', ['굴림']),
  office('STKaiti', 'eastAsian', 'cloud', ['华文楷体']),
  office('STFangsong', 'eastAsian', 'cloud', ['华文仿宋']),
  office('STXihei', 'eastAsian', 'cloud', ['华文细黑']),
  office('STZhongsong', 'eastAsian', 'cloud', ['华文中宋']),
  office('STXingkai', 'eastAsian', 'cloud', ['华文行楷']),
  office('STXinwei', 'eastAsian', 'cloud', ['华文新魏']),
  office('STHupo', 'eastAsian', 'cloud', ['华文琥珀']),
  office('STCaiyun', 'eastAsian', 'cloud', ['华文彩云']),
]);

const OFFICE_FONT_INDEX: ReadonlyMap<string, OfficeFontFamily> = new Map(
  OFFICE_FONT_FAMILIES.flatMap((entry) => (
    [entry.family, ...entry.localNames].map((name) => [normalizeFamilyName(name), entry] as const)
  )),
);

/**
 * 常见目标环境缺失字体的替换建议，按“字形气质相近”排列。
 * 只给方向，不替 Agent 决定；未列出的 family 按脚本给通用建议。
 */
const OFFICE_ALTERNATIVE_GROUPS: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  [['pingfang sc', 'pingfang tc', 'pingfang hk', 'hiragino sans gb', 'heiti sc', 'heiti tc', 'stheiti', 'source han sans sc', 'noto sans sc', 'noto sans cjk sc', 'lantinghei sc'], ['Microsoft YaHei', 'DengXian', 'SimHei']],
  [['songti sc', 'songti tc', 'stsong', 'source han serif sc', 'noto serif sc', 'noto serif cjk sc'], ['SimSun', 'STZhongsong']],
  [['kaiti sc', 'kaiti tc', 'stkaiti sc', 'lxgw wenkai', 'baoli sc', 'hannotate sc'], ['KaiTi', 'STKaiti']],
  [['fangsong sc'], ['FangSong', 'STFangsong']],
  [['xingkai sc', 'libian sc', 'wawati sc', 'weibei sc', 'yuppy sc', 'ma shan zheng', 'zhi mang xing', 'liu jian mao cao', 'long cang'], ['STXingkai', 'STXinwei', 'KaiTi']],
  [['helvetica', 'helvetica neue', 'sf pro', 'sf pro display', 'sf pro text', 'avenir', 'avenir next', 'inter', 'roboto', 'segoe ui', 'open sans', 'lato', 'source sans pro'], ['Arial', 'Calibri', 'Aptos']],
  [['futura', 'avant garde', 'montserrat', 'poppins'], ['Century Gothic', 'Tw Cen MT']],
  [['gill sans'], ['Gill Sans MT']],
  [['baskerville', 'didot', 'bodoni 72', 'hoefler text', 'big caslon', 'playfair display', 'libre baskerville', 'eb garamond', 'cormorant garamond', 'source serif pro', 'charter', 'iowan old style', 'new york'], ['Georgia', 'Garamond', 'Book Antiqua']],
  [['palatino'], ['Palatino Linotype', 'Book Antiqua']],
  [['menlo', 'monaco', 'sf mono', 'jetbrains mono', 'fira code', 'source code pro'], ['Consolas', 'Courier New']],
];

const OFFICE_ALTERNATIVES: ReadonlyMap<string, readonly string[]> = new Map(
  OFFICE_ALTERNATIVE_GROUPS.flatMap(([names, alternatives]) => names.map((name) => [name, alternatives] as const)),
);

const SCRIPT_FALLBACK_ALTERNATIVES: Readonly<Record<TextFontScript, readonly string[]>> = {
  latin: ['Arial', 'Georgia', 'Calibri'],
  eastAsian: ['Microsoft YaHei', 'SimSun', 'KaiTi'],
  complex: ['Arial', 'Times New Roman'],
};

export interface FontDeliveryAssessment {
  readonly target: FontDeliveryTarget;
  readonly status: FontDeliveryStatus;
  /** 命中 Office 表时的规范 family 名；本地化名称会被归一到这里。 */
  readonly officeFamily?: string;
  /** `unavailable` 时给出的 Office 可交付替换方向。 */
  readonly alternatives: readonly string[];
}

/**
 * 判断一个 family 在目标环境中能否交付。`local` 目标下一律视为 core：
 * 本机缺失由字体解析的 unresolved/substituted 事实单独报告，这里不重复判断。
 */
export function assessFontDelivery(
  family: string,
  target: FontDeliveryTarget,
  script?: TextFontScript,
): FontDeliveryAssessment {
  if (target === 'local') {
    return { target, status: 'core', alternatives: [] };
  }
  const normalized = normalizeFamilyName(family);
  const entry = OFFICE_FONT_INDEX.get(normalized);
  if (entry != null) {
    return { target, status: entry.status, officeFamily: entry.family, alternatives: [] };
  }
  const alternatives = OFFICE_ALTERNATIVES.get(normalized)
    ?? SCRIPT_FALLBACK_ALTERNATIVES[script ?? 'latin'];
  return { target, status: 'unavailable', alternatives };
}

/** 只有生成稿由 Agent 选字体，导入稿保留作者原有字体，不做可交付性检查。 */
export function resolveDeckFontDeliveryTarget(
  sourceKind: 'generated' | 'imported' | 'patched',
  theme: { readonly fontTarget?: FontDeliveryTarget } | undefined,
): FontDeliveryTarget | undefined {
  return sourceKind === 'generated' ? theme?.fontTarget ?? DEFAULT_FONT_DELIVERY_TARGET : undefined;
}

export function listOfficeFontFamilies(script: TextFontScript): readonly OfficeFontFamily[] {
  return OFFICE_FONT_FAMILIES.filter((entry) => entry.script === script);
}

export function isFontDeliveryTarget(value: unknown): value is FontDeliveryTarget {
  return value === 'office' || value === 'local';
}

function normalizeFamilyName(family: string): string {
  return family.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export type ScriptClass = 'latin' | 'eastAsian' | 'complex';
export type FontFamilyStyle = 'regular' | 'bold' | 'italic';

export interface PluginFontFamilyCandidate {
  readonly family: string;
  readonly scripts: readonly ScriptClass[];
  readonly styles: readonly FontFamilyStyle[];
  readonly monospace: boolean;
}

export interface PluginFontFamilyCheckResult {
  readonly requestedFamily: string;
  readonly installed: boolean;
  readonly match?: PluginFontFamilyCandidate;
}

export interface PluginFontFamilyListRequest {
  readonly script: ScriptClass;
  readonly offset: number;
  readonly limit: number;
}

export interface PluginFontFamilyListResult {
  readonly script: ScriptClass;
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
  readonly hasMore: boolean;
  readonly families: readonly PluginFontFamilyCandidate[];
}

export declare class FontCatalogUnavailableError extends Error {
  readonly code: 'font.catalog_unavailable';
}

export interface PluginFontMetadata {
  readonly family: string;
  readonly subfamily: string;
  readonly postscriptName: string;
  readonly filePath: string;
  readonly faceIndex: number;
  /** 字体文件内容 + face 身份的安全 SHA-256；不得用它反推或替代 filePath。 */
  readonly faceFingerprint?: string;
  readonly panose: readonly number[];
  readonly unicodeRanges: readonly [number, number, number, number];
  readonly glyphCodePointRanges: readonly (readonly [number, number])[];
  readonly codePageRanges?: readonly [number, number];
  readonly isFixedPitch: boolean;
  readonly avgCharWidth: number;
  readonly xHeight?: number;
  readonly capHeight?: number;
  readonly winAscent: number;
  readonly winDescent: number;
  readonly typoAscent: number;
  readonly typoDescent: number;
  readonly typoLineGap: number;
  readonly useTypoMetrics: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface PluginFontRequest {
  /** 原始请求字体名（OOXML typeface 或 spec fontFamily）。 */
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** 请求文本的主导脚本，影响候选池与打分。 */
  readonly script: ScriptClass;
  /** 当前 run 真正需要绘制的 Unicode code point；候选 cmap 必须全部覆盖。 */
  readonly requiredCodePoints?: readonly number[];
}

export type PluginFontResolutionKind = 'not-ready' | 'exact' | 'substituted' | 'unresolved';

export interface PluginResolvedFont {
  readonly request: PluginFontRequest;
  /** 渲染/测量应声明的字体名；目录未就绪或无候选时保持原始请求名。 */
  readonly resolvedFamily: string;
  /** false 表示系统字体目录还没扫描完，消费方不能把结果当作稳定替换决策。 */
  readonly catalogReady: boolean;
  /** true = 命中请求字体本身，未发生替换；catalogReady=false 时仅表示暂用原始请求名。 */
  readonly exactMatch: boolean;
  /** catalogReady 且 exact/substituted 时存在，供文本布局读取 OS/2 行度量。 */
  readonly resolved?: PluginFontMetadata;
  readonly penalty: number | null;
  readonly resolution: PluginFontResolutionKind;
}

export declare function resolveFont(request: PluginFontRequest): PluginResolvedFont;
export declare function classifyDominantScript(text: string): ScriptClass;
export declare function collectRequiredGlyphCodePoints(text: string): readonly number[];
export declare function checkFontFamily(family: string): Promise<PluginFontFamilyCheckResult>;
export declare function listFontFamilies(
  request: PluginFontFamilyListRequest,
): Promise<PluginFontFamilyListResult>;

/** 仅供 standalone backend process adapter 建立独立的系统字体查询生命周期。 */
export interface PluginSystemFontCatalogQueryRuntime {
  scan(): Promise<void>;
  checkFontFamily(family: string): Promise<PluginFontFamilyCheckResult>;
  listFontFamilies(request: PluginFontFamilyListRequest): Promise<PluginFontFamilyListResult>;
}

export declare function createSystemFontCatalogQueryRuntime(options: {
  readonly runtimeDataDirectory: string;
}): PluginSystemFontCatalogQueryRuntime;

/** 仅供 standalone backend process 持有完整字体解析生命周期。 */
export interface PluginSystemFontResolutionRuntime {
  initialize(): Promise<void>;
  dispose(): void;
  checkFontFamily(family: string): Promise<PluginFontFamilyCheckResult>;
  listFontFamilies(
    request: PluginFontFamilyListRequest,
  ): Promise<PluginFontFamilyListResult>;
}

export declare function createSystemFontResolutionRuntime(options: {
  readonly runtimeDataDirectory: string;
}): PluginSystemFontResolutionRuntime;

/** 保留完整 grapheme，连续相同 face 合并；原始字体请求仍随结果保留。 */
export declare function resolveFontText(
  text: string,
  request: Omit<PluginFontRequest, 'script' | 'requiredCodePoints'>,
): Array<{ text: string; font: PluginResolvedFont }>;

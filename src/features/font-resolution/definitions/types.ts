/** 从字体文件 name/OS2/head/hhea 表提取的、影响排版结果的元数据。所有长度值已按 unitsPerEm 归一化。 */
export interface FontMetadata {
  family: string;
  subfamily: string;
  postscriptName: string;
  filePath: string;
  /** .ttc collection 内的 face 序号；单字体文件恒为 0。 */
  faceIndex: number;
  /**
   * 字体文件内容 + face 身份的 SHA-256。用于跨进程排版归因；消费方可以公开该值，
   * 但不能公开 filePath。旧缓存或测试桩可能没有该字段。
   */
  faceFingerprint?: string;
  /** OS/2 panose 10 字节 */
  panose: readonly number[];
  /** OS/2 ulUnicodeRange1-4 */
  unicodeRanges: readonly [number, number, number, number];
  /**
   * cmap 实际声明的 Unicode code point 覆盖，按闭区间压缩保存。
   * OS/2 range 只负责脚本候选粗筛；逐字覆盖判断必须读取这里。
   */
  glyphCodePointRanges: readonly (readonly [number, number])[];
  /** OS/2 ulCodePageRange1-2；旧字体可能缺失 */
  codePageRanges?: readonly [number, number];
  isFixedPitch: boolean;
  /** OS/2 xAvgCharWidth / unitsPerEm */
  avgCharWidth: number;
  xHeight?: number;
  capHeight?: number;
  /** usWinAscent / unitsPerEm */
  winAscent: number;
  winDescent: number;
  typoAscent: number;
  typoDescent: number;
  typoLineGap: number;
  /** OS/2 fsSelection bit7 USE_TYPO_METRICS */
  useTypoMetrics: boolean;
  bold: boolean;
  italic: boolean;
}

export type ScriptClass = 'latin' | 'eastAsian' | 'complex';

export interface FontRequest {
  /** 原始请求字体名（OOXML typeface 或 spec fontFamily） */
  family: string;
  bold: boolean;
  italic: boolean;
  /** 请求文本的主导脚本，影响候选池与打分 */
  script: ScriptClass;
  /** 当前 run 真正需要绘制的 Unicode code point；候选 cmap 必须全部覆盖。 */
  requiredCodePoints?: readonly number[];
}

export type FontResolutionKind = 'not-ready' | 'exact' | 'substituted' | 'unresolved';

interface FontResolutionBase {
  request: FontRequest;
  /** 渲染/测量应声明的字体名；目录未就绪或无候选时保持原始请求名。 */
  resolvedFamily: string;
  /** false 表示系统字体目录还没扫描完，消费方不能把结果当作稳定替换决策。 */
  catalogReady: boolean;
  /** true = 命中请求字体本身，未发生替换；catalogReady=false 时仅表示暂用原始请求名。 */
  exactMatch: boolean;
  penalty: number | null;
  resolution: FontResolutionKind;
}

export interface ResolvedCatalogFont extends FontResolutionBase {
  catalogReady: true;
  /** 最终选定字体 */
  resolved: FontMetadata;
  exactMatch: boolean;
  penalty: number;
  resolution: 'exact' | 'substituted';
}

export interface UnresolvedFont extends FontResolutionBase {
  resolved?: undefined;
  resolution: 'not-ready' | 'unresolved';
}

export type ResolvedFont = ResolvedCatalogFont | UnresolvedFont;

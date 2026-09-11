import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { FontMetadata, ScriptClass } from '../definitions/types.js';
import {
  FontCatalogUnavailableError,
  type FontCatalogState,
} from '../definitions/fontCatalogQuery.js';
import { parseFontFileMetadata as defaultParseFontFileMetadata } from '../functions/parseFontMetadata.js';
import {
  hasScriptCoverage,
  isPublicFontFamily,
} from '../functions/scriptCoverage.js';

export interface FontCatalogOptions {
  scanRoots?: readonly string[];
  /** 由装配点传入 app userData 下路径；这里只保存字体 metadata，不保存字体文件本体。 */
  cacheFilePath: string;
  parseFontFileMetadata?: (filePath: string) => readonly FontMetadata[];
}

interface FontFileIdentity {
  filePath: string;
  size: number;
  mtimeMs: number;
}

interface FontCatalogCacheEntry extends FontFileIdentity {
  fonts: readonly FontMetadata[];
}

// v4 增加压缩后的 cmap 覆盖区间；旧 OS/2-only 缓存不能继续参与逐字解析。
const CACHE_VERSION = 4;
const FONT_FILE_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc']);

export class FontCatalog {
  private readonly scanRoots: readonly string[];
  private readonly cacheFilePath: string;
  private readonly parseFontFileMetadata: (filePath: string) => readonly FontMetadata[];
  private fonts: FontMetadata[] = [];
  private fontsByFamily = new Map<string, FontMetadata[]>();
  private state: FontCatalogState = 'idle';
  private activeScan: Promise<void> | null = null;

  constructor(options: FontCatalogOptions) {
    this.scanRoots = options.scanRoots ?? defaultScanRoots();
    this.cacheFilePath = options.cacheFilePath;
    this.parseFontFileMetadata = options.parseFontFileMetadata ?? defaultParseFontFileMetadata;
  }

  scan(): Promise<void> {
    if (this.state === 'scanning' && this.activeScan) {
      return this.activeScan;
    }

    this.state = 'scanning';
    const activeScan = this.performScan();
    this.activeScan = activeScan;
    return activeScan;
  }

  private async performScan(): Promise<void> {
    try {
      await this.buildCatalog();
      this.state = 'ready';
    } catch (error) {
      this.state = 'failed';
      throw error;
    }
  }

  private async buildCatalog(): Promise<void> {
    const cachedEntries = await this.readCache();
    const nextEntries = new Map<string, FontCatalogCacheEntry>();
    const nextFonts: FontMetadata[] = [];
    const fontFiles = await this.collectFontFiles();

    for (const filePath of fontFiles) {
      const identity = await readFontFileIdentity(filePath);
      if (identity == null) {
        continue;
      }

      const cachedEntry = cachedEntries.get(filePath);
      const entry = isCacheEntryFresh(cachedEntry, identity)
        ? cachedEntry
        : {
            ...identity,
            fonts: this.parseFontFileMetadata(filePath),
          };

      nextEntries.set(filePath, entry);
      nextFonts.push(...entry.fonts);
    }

    this.fonts = nextFonts;
    this.fontsByFamily = buildFamilyIndex(nextFonts);
    await writeCache(this.cacheFilePath, [...nextEntries.values()]);
  }

  findByFamily(family: string): FontMetadata[] {
    return [...(this.fontsByFamily.get(normalizeFamilyName(family)) ?? [])];
  }

  allFonts(): readonly FontMetadata[] {
    return [...this.fonts];
  }

  candidatesForScript(script: ScriptClass): readonly FontMetadata[] {
    return this.fonts.filter((font) => (
      isPublicFontFamily(font.family) && hasScriptCoverage(font, script)
    ));
  }

  isReady(): boolean {
    return this.state === 'ready';
  }

  getState(): FontCatalogState {
    return this.state;
  }

  async waitUntilReady(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state !== 'scanning' || !this.activeScan) {
      throw new FontCatalogUnavailableError();
    }
    try {
      await this.activeScan;
    } catch {
      throw new FontCatalogUnavailableError();
    }
  }

  private async collectFontFiles(): Promise<readonly string[]> {
    const fontFiles: string[] = [];
    for (const root of this.scanRoots) {
      await collectFontFilesFromRoot(resolve(root), fontFiles);
    }
    return fontFiles.sort((first, second) => first.localeCompare(second));
  }

  private async readCache(): Promise<Map<string, FontCatalogCacheEntry>> {
    try {
      const raw = await readFile(this.cacheFilePath, 'utf8');
      return parseCacheFile(raw);
    } catch {
      // 缓存文件属于本地派生数据，缺失或损坏时重建 metadata 索引即可；字体文件本体从不写入缓存。
      return new Map();
    }
  }
}

async function collectFontFilesFromRoot(root: string, fontFiles: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    // 系统字体目录可能不存在或无权限，跳过该 root，不影响其他目录。
    return;
  }

  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await collectFontFilesFromRoot(entryPath, fontFiles);
      continue;
    }
    if (entry.isFile() && isSupportedFontFile(entry.name)) {
      fontFiles.push(entryPath);
    }
  }
}

function isSupportedFontFile(fileName: string): boolean {
  return FONT_FILE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

async function readFontFileIdentity(filePath: string): Promise<FontFileIdentity | null> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return null;
    }
    return {
      filePath,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    };
  } catch {
    return null;
  }
}

function isCacheEntryFresh(
  entry: FontCatalogCacheEntry | undefined,
  identity: FontFileIdentity,
): entry is FontCatalogCacheEntry {
  return entry != null
    && entry.size === identity.size
    && entry.mtimeMs === identity.mtimeMs;
}

function buildFamilyIndex(fonts: readonly FontMetadata[]): Map<string, FontMetadata[]> {
  const index = new Map<string, FontMetadata[]>();
  for (const font of fonts) {
    const familyKey = normalizeFamilyName(font.family);
    const existing = index.get(familyKey);
    if (existing == null) {
      index.set(familyKey, [font]);
    } else {
      existing.push(font);
    }
  }
  return index;
}

function normalizeFamilyName(family: string): string {
  return family.trim().toLocaleLowerCase('en-US');
}

async function writeCache(cacheFilePath: string, entries: readonly FontCatalogCacheEntry[]): Promise<void> {
  await mkdir(dirname(cacheFilePath), { recursive: true });
  await writeFile(cacheFilePath, JSON.stringify({
    version: CACHE_VERSION,
    entries,
  }, null, 2));
}

function parseCacheFile(raw: string): Map<string, FontCatalogCacheEntry> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.entries)) {
    return new Map();
  }

  const entries = new Map<string, FontCatalogCacheEntry>();
  for (const value of parsed.entries) {
    const entry = parseCacheEntry(value);
    if (entry != null) {
      entries.set(entry.filePath, entry);
    }
  }
  return entries;
}

function parseCacheEntry(value: unknown): FontCatalogCacheEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const filePath = value.filePath;
  const size = value.size;
  const mtimeMs = value.mtimeMs;
  const fonts = value.fonts;
  if (typeof filePath !== 'string' || typeof size !== 'number' || typeof mtimeMs !== 'number' || !Array.isArray(fonts)) {
    return null;
  }

  const parsedFonts: FontMetadata[] = [];
  for (const fontValue of fonts) {
    const font = parseCachedFontMetadata(fontValue);
    if (font == null) {
      return null;
    }
    parsedFonts.push(font);
  }

  return {
    filePath,
    size,
    mtimeMs,
    fonts: parsedFonts,
  };
}

function parseCachedFontMetadata(value: unknown): FontMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const panose = readNumberArray(value.panose);
  const unicodeRanges = readNumberTuple4(value.unicodeRanges);
  const glyphCodePointRanges = readCodePointRanges(value.glyphCodePointRanges);
  const codePageRanges = readOptionalNumberTuple2(value.codePageRanges);
  if (
    typeof value.family !== 'string'
    || typeof value.subfamily !== 'string'
    || typeof value.postscriptName !== 'string'
    || typeof value.filePath !== 'string'
    || typeof value.faceIndex !== 'number'
    || panose == null
    || unicodeRanges == null
    || glyphCodePointRanges == null
    || codePageRanges === null
    || typeof value.isFixedPitch !== 'boolean'
    || typeof value.avgCharWidth !== 'number'
    || typeof value.winAscent !== 'number'
    || typeof value.winDescent !== 'number'
    || typeof value.typoAscent !== 'number'
    || typeof value.typoDescent !== 'number'
    || typeof value.typoLineGap !== 'number'
    || typeof value.useTypoMetrics !== 'boolean'
    || typeof value.bold !== 'boolean'
    || typeof value.italic !== 'boolean'
  ) {
    return null;
  }

  const xHeight = readOptionalNumber(value.xHeight);
  const capHeight = readOptionalNumber(value.capHeight);
  const faceFingerprint = readOptionalString(value.faceFingerprint);
  if (xHeight === null || capHeight === null || faceFingerprint === null) {
    return null;
  }

  return {
    family: value.family,
    subfamily: value.subfamily,
    postscriptName: value.postscriptName,
    filePath: value.filePath,
    faceIndex: value.faceIndex,
    faceFingerprint,
    panose,
    unicodeRanges,
    glyphCodePointRanges,
    codePageRanges,
    isFixedPitch: value.isFixedPitch,
    avgCharWidth: value.avgCharWidth,
    xHeight,
    capHeight,
    winAscent: value.winAscent,
    winDescent: value.winDescent,
    typoAscent: value.typoAscent,
    typoDescent: value.typoDescent,
    typoLineGap: value.typoLineGap,
    useTypoMetrics: value.useTypoMetrics,
    bold: value.bold,
    italic: value.italic,
  };
}

function readOptionalString(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : null;
}

function readNumberArray(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'number')) {
    return null;
  }
  return value;
}

function readNumberTuple4(value: unknown): readonly [number, number, number, number] | null {
  const numbers = readNumberArray(value);
  if (numbers == null || numbers.length !== 4) {
    return null;
  }
  const [first, second, third, fourth] = numbers;
  if (first == null || second == null || third == null || fourth == null) {
    return null;
  }
  return [first, second, third, fourth];
}

function readCodePointRanges(
  value: unknown,
): readonly (readonly [number, number])[] | null {
  if (!Array.isArray(value)) return null;
  const ranges: Array<readonly [number, number]> = [];
  let previousEnd = -1;
  for (const item of value) {
    const pair = readNumberArray(item);
    if (pair == null || pair.length !== 2) return null;
    const [start, end] = pair;
    if (
      start == null
      || end == null
      || !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end > 0x10FFFF
      || start > end
      || start <= previousEnd
    ) {
      return null;
    }
    ranges.push([start, end]);
    previousEnd = end;
  }
  return ranges;
}

function readOptionalNumberTuple2(value: unknown): readonly [number, number] | undefined | null {
  if (value == null) {
    return undefined;
  }
  const numbers = readNumberArray(value);
  if (numbers == null || numbers.length !== 2) {
    return null;
  }
  const [first, second] = numbers;
  if (first == null || second == null) {
    return null;
  }
  return [first, second];
}

function readOptionalNumber(value: unknown): number | undefined | null {
  if (value == null) {
    return undefined;
  }
  return typeof value === 'number' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultScanRoots(): readonly string[] {
  const home = homedir();
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      // PingFang 等按需字体位于系统资产库；仍只扫描字体文件和缓存 metadata。
      '/System/Library/AssetsV2/com_apple_MobileAsset_Font8',
      '/Library/Fonts',
      join(home, 'Library/Fonts'),
    ];
  }
  if (process.platform === 'win32') {
    const roots: string[] = [];
    const windowsDir = process.env.WINDIR;
    const localAppData = process.env.LOCALAPPDATA;
    if (windowsDir != null) {
      roots.push(join(windowsDir, 'Fonts'));
    }
    if (localAppData != null) {
      roots.push(join(localAppData, 'Microsoft/Windows/Fonts'));
    }
    return roots;
  }
  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    join(home, '.fonts'),
    join(home, '.local/share/fonts'),
  ];
}

import { readFileSync } from 'node:fs';
import { HeuristicMeasureAdapter } from '../../adapters/HeuristicMeasureAdapter.js';
import type {
  ClusterAdvanceMeasureResult,
  FontFileLocator,
  NormalizedClusterAdvanceRequest,
  ResolvedFontFile,
} from '../../definitions/types.js';
import { projectFontUnitAdvances, type FontUnitAdvances } from '@linnya/text-measurement-core';
import { getReadyHarfBuzzModule, isHarfBuzzReady, type HarfBuzzModule } from './harfbuzzModule.js';

const DEFAULT_CLUSTER_ADVANCE_CACHE_MAX_ENTRIES = 5000;

interface HarfBuzzClusterAdvanceProviderOptions {
  readonly fontFileLocator: FontFileLocator;
  readonly fallback?: HeuristicMeasureAdapter;
  readonly maxCacheEntries?: number;
}

interface CachedFaceFont {
  readonly face: InstanceType<HarfBuzzModule['Face']>;
  readonly font: InstanceType<HarfBuzzModule['Font']>;
}

export class HarfBuzzClusterAdvanceProvider {
  readonly kind = 'harfbuzz';

  private readonly fontFileLocator: FontFileLocator;
  private readonly fallback: HeuristicMeasureAdapter;
  private readonly maxCacheEntries: number;
  private readonly faceFontCache = new Map<string, CachedFaceFont>();
  private readonly clusterAdvanceCache = new Map<string, FontUnitAdvances>();

  constructor(options: HarfBuzzClusterAdvanceProviderOptions) {
    this.fontFileLocator = options.fontFileLocator;
    this.fallback = options.fallback ?? new HeuristicMeasureAdapter();
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? DEFAULT_CLUSTER_ADVANCE_CACHE_MAX_ENTRIES);
  }

  measureClusterAdvances(request: NormalizedClusterAdvanceRequest): number[] {
    return this.measureClusterAdvancesWithSource(request).advances;
  }

  measureClusterAdvancesWithSource(request: NormalizedClusterAdvanceRequest): ClusterAdvanceMeasureResult {
    if (!isHarfBuzzReady()) {
      return this.measureWithFallback(request);
    }

    const resolvedFont = this.locateFont(request);
    if (resolvedFont == null) {
      return this.measureWithFallback(request);
    }

    const cacheKey = createClusterAdvanceCacheKey(request, resolvedFont);
    const cached = this.getClusterAdvanceCache(cacheKey);
    if (cached != null) {
      return {
        advances: projectFontUnitAdvances(cached, request.style.fontSizePt, request.style.letterSpacingPt),
        fontUnits: cached,
        source: 'harfbuzz',
      };
    }

    try {
      const advances = this.shapeClusterAdvances(request, resolvedFont);
      this.setClusterAdvanceCache(cacheKey, advances);
      return {
        advances: projectFontUnitAdvances(advances, request.style.fontSizePt, request.style.letterSpacingPt),
        fontUnits: advances,
        source: 'harfbuzz',
      };
    } catch {
      return this.measureWithFallback(request);
    }
  }

  async prewarmClusterAdvances(requests: readonly NormalizedClusterAdvanceRequest[]): Promise<void> {
    if (!isHarfBuzzReady()) {
      return;
    }
    for (const request of requests) {
      this.measureClusterAdvancesWithSource(request);
    }
  }

  private locateFont(request: NormalizedClusterAdvanceRequest): ResolvedFontFile | undefined {
    const family = request.style.fontFamily;
    if (family == null || family.trim().length === 0) {
      return undefined;
    }

    const text = request.clusters.join('');
    return this.fontFileLocator.locate({
      family,
      bold: request.style.bold,
      italic: request.style.italic,
      script: inferScriptClass(text),
      text,
    });
  }

  private shapeClusterAdvances(
    request: NormalizedClusterAdvanceRequest,
    resolvedFont: ResolvedFontFile,
  ): FontUnitAdvances {
    const harfbuzz = getReadyHarfBuzzModule();
    const faceFont = this.getFaceFont(harfbuzz, resolvedFont);
    const joinedText = request.clusters.join('');
    const clusterStarts = collectClusterStarts(request.clusters);
    const buffer = new harfbuzz.Buffer();
    buffer.addText(joinedText);
    buffer.guessSegmentProperties();
    harfbuzz.shape(faceFont.font, buffer);

    const rawAdvances = new Array<number>(request.clusters.length).fill(0);
    for (const glyph of buffer.getGlyphInfosAndPositions()) {
      const clusterIndex = findClusterIndex(clusterStarts, glyph.cluster);
      if (clusterIndex == null) {
        continue;
      }
      rawAdvances[clusterIndex] += glyph.xAdvance ?? 0;
    }

    return { unitsPerEm: faceFont.face.upem, advances: rawAdvances };
  }

  private getFaceFont(harfbuzz: HarfBuzzModule, resolvedFont: ResolvedFontFile): CachedFaceFont {
    const cacheKey = `${resolvedFont.filePath}#${resolvedFont.faceIndex}`;
    const cached = this.faceFontCache.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    const fontBytes = readFileSync(resolvedFont.filePath);
    const fontData = fontBytes.buffer.slice(
      fontBytes.byteOffset,
      fontBytes.byteOffset + fontBytes.byteLength,
    );
    const blob = new harfbuzz.Blob(fontData);
    const face = new harfbuzz.Face(blob, resolvedFont.faceIndex);
    const font = new harfbuzz.Font(face);
    const next = { face, font };
    this.faceFontCache.set(cacheKey, next);
    return next;
  }

  private measureWithFallback(request: NormalizedClusterAdvanceRequest): ClusterAdvanceMeasureResult {
    return this.fallback.measureClusterAdvancesWithSource(request);
  }

  private getClusterAdvanceCache(cacheKey: string): FontUnitAdvances | undefined {
    const cached = this.clusterAdvanceCache.get(cacheKey);
    if (cached == null) {
      return undefined;
    }
    this.clusterAdvanceCache.delete(cacheKey);
    this.clusterAdvanceCache.set(cacheKey, cached);
    return cached;
  }

  private setClusterAdvanceCache(cacheKey: string, advances: FontUnitAdvances): void {
    if (this.clusterAdvanceCache.has(cacheKey)) {
      this.clusterAdvanceCache.delete(cacheKey);
    }
    this.clusterAdvanceCache.set(cacheKey, advances);
    while (this.clusterAdvanceCache.size > this.maxCacheEntries) {
      const oldestKey = this.clusterAdvanceCache.keys().next().value;
      if (oldestKey == null) {
        return;
      }
      this.clusterAdvanceCache.delete(oldestKey);
    }
  }
}

function createClusterAdvanceCacheKey(
  request: NormalizedClusterAdvanceRequest,
  resolvedFont: ResolvedFontFile,
): string {
  return JSON.stringify({
    font: {
      filePath: resolvedFont.filePath,
      faceIndex: resolvedFont.faceIndex,
      postscriptName: resolvedFont.postscriptName,
    },
    clusters: request.clusters,
    bold: request.style.bold,
    italic: request.style.italic,
    sourceKind: request.sourceKind,
  });
}

function collectClusterStarts(clusters: readonly string[]): readonly number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const cluster of clusters) {
    starts.push(offset);
    offset += cluster.length;
  }
  return starts;
}

function findClusterIndex(clusterStarts: readonly number[], glyphCluster: number): number | null {
  if (clusterStarts.length === 0) {
    return null;
  }
  let lower = 0;
  let upper = clusterStarts.length - 1;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const start = clusterStarts[middle] ?? 0;
    const nextStart = clusterStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (glyphCluster >= start && glyphCluster < nextStart) {
      return middle;
    }
    if (glyphCluster < start) {
      upper = middle - 1;
    } else {
      lower = middle + 1;
    }
  }
  return null;
}

function inferScriptClass(text: string): 'latin' | 'eastAsian' | 'complex' {
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null) {
      continue;
    }
    if (isEastAsianCodePoint(codePoint)) {
      return 'eastAsian';
    }
    if (isComplexScriptCodePoint(codePoint)) {
      return 'complex';
    }
  }
  return 'latin';
}

function isEastAsianCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x30FF)
    || (codePoint >= 0x3400 && codePoint <= 0x4DBF)
    || (codePoint >= 0x4E00 && codePoint <= 0x9FFF)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7AF)
    || (codePoint >= 0xFF00 && codePoint <= 0xFFEF)
  );
}

function isComplexScriptCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0590 && codePoint <= 0x08FF)
    || (codePoint >= 0x0900 && codePoint <= 0x0DFF)
    || (codePoint >= 0x1780 && codePoint <= 0x17FF)
  );
}

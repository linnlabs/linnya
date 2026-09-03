import type {
  FontMetadata,
  FontRequest,
  ResolvedCatalogFont,
  ResolvedFont,
  ScriptClass,
} from '../definitions/types.js';
import { hasRequiredGlyphCoverage } from '../functions/glyphCoverage.js';
import { scoreSubstitution as defaultScoreSubstitution } from '../functions/substitutionPenalty.js';

export interface FontResolutionCatalog {
  isReady(): boolean;
  findByFamily(family: string): readonly FontMetadata[];
  candidatesForScript(script: ScriptClass): readonly FontMetadata[];
}

export type FontSubstitutionScorer = (
  request: FontRequest,
  candidate: FontMetadata,
  requestedMeta?: FontMetadata,
) => number;

export interface FontResolutionServiceOptions {
  catalog: FontResolutionCatalog;
  scoreSubstitution?: FontSubstitutionScorer;
}

export class FontResolutionService {
  private catalog: FontResolutionCatalog;
  private readonly scoreSubstitution: FontSubstitutionScorer;
  private readonly cache = new Map<string, ResolvedFont>();

  constructor(options: FontResolutionServiceOptions) {
    this.catalog = options.catalog;
    this.scoreSubstitution = options.scoreSubstitution ?? defaultScoreSubstitution;
  }

  resolve(request: FontRequest): ResolvedFont {
    if (!this.catalog.isReady()) {
      // 系统字体目录尚未建立时只能沿用原始声明；不能把它缓存成稳定解析结果。
      return {
        request,
        resolvedFamily: request.family,
        catalogReady: false,
        exactMatch: true,
        penalty: null,
        resolution: 'not-ready',
      };
    }

    const cacheKey = buildCacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    const resolved = this.resolveReadyCatalogRequest(request);
    this.cache.set(cacheKey, resolved);
    return resolved;
  }

  configureCatalog(catalog: FontResolutionCatalog): void {
    this.catalog = catalog;
    this.cache.clear();
  }

  resetCache(): void {
    this.cache.clear();
  }

  private resolveReadyCatalogRequest(request: FontRequest): ResolvedFont {
    const requestedFamilyCandidates = this.catalog.findByFamily(request.family);
    const exactCandidates = requestedFamilyCandidates
      .filter((font) => hasRequiredGlyphCoverage(
        font,
        request.requiredCodePoints,
      ));
    if (exactCandidates.length > 0) {
      return makeResolvedFont(
        request,
        chooseLowestPenalty(request, exactCandidates, this.scoreSubstitution),
        true,
      );
    }

    const candidates = this.catalog.candidatesForScript(request.script)
      .filter((font) => hasRequiredGlyphCoverage(
        font,
        request.requiredCodePoints,
      ));
    if (candidates.length === 0) {
      return {
        request,
        resolvedFamily: request.family,
        catalogReady: true,
        exactMatch: false,
        penalty: null,
        resolution: 'unresolved',
      };
    }

    return makeResolvedFont(
      request,
      chooseLowestPenalty(
        request,
        candidates,
        this.scoreSubstitution,
        chooseRequestedFamilyReference(request, requestedFamilyCandidates),
      ),
      false,
    );
  }
}

function chooseLowestPenalty(
  request: FontRequest,
  candidates: readonly FontMetadata[],
  scoreSubstitution: FontSubstitutionScorer,
  requestedMeta?: FontMetadata,
): {
  font: FontMetadata;
  penalty: number;
} {
  // 字重/斜体是 face 身份，不是可被轻微 metrics 优势抵消的普通 penalty。
  // 只要存在样式完全匹配的候选，就先在该集合内比较字体相似度。
  const styleCompatible = candidates.filter((candidate) => (
    candidate.bold === request.bold && candidate.italic === request.italic
  ));
  const eligibleCandidates = styleCompatible.length > 0 ? styleCompatible : candidates;
  const first = eligibleCandidates[0];
  if (first == null) {
    throw new Error('FontResolutionService requires at least one candidate when scoring fonts');
  }

  let best = {
    font: first,
    penalty: scoreSubstitution(request, first, requestedMeta),
  };

  for (const candidate of eligibleCandidates.slice(1)) {
    const penalty = scoreSubstitution(request, candidate, requestedMeta);
    if (penalty < best.penalty) {
      best = {
        font: candidate,
        penalty,
      };
    }
  }

  return best;
}

/**
 * 请求 family 已安装但缺少当前字形时，它仍是替代字体相似度的权威参考。
 * 优先使用同字重/斜体 face；不能因为该 face 缺字，就退回与原字体无关的脚本基线。
 */
function chooseRequestedFamilyReference(
  request: FontRequest,
  candidates: readonly FontMetadata[],
): FontMetadata | undefined {
  return candidates.find((candidate) => (
    candidate.bold === request.bold && candidate.italic === request.italic
  )) ?? candidates[0];
}

function makeResolvedFont(
  request: FontRequest,
  best: {
    font: FontMetadata;
    penalty: number;
  },
  exactMatch: boolean,
): ResolvedCatalogFont {
  return {
    request,
    resolved: best.font,
    resolvedFamily: best.font.family,
    catalogReady: true,
    exactMatch,
    penalty: best.penalty,
    resolution: exactMatch ? 'exact' : 'substituted',
  };
}

function buildCacheKey(request: FontRequest): string {
  return [
    normalizeFamilyName(request.family),
    request.bold ? 'bold' : 'regular',
    request.italic ? 'italic' : 'upright',
    request.script,
    normalizeRequiredCodePoints(request.requiredCodePoints),
  ].join('|');
}

function normalizeRequiredCodePoints(codePoints: readonly number[] | undefined): string {
  if (codePoints == null || codePoints.length === 0) return '';
  return [...new Set(codePoints)].sort((first, second) => first - second).join(',');
}

function normalizeFamilyName(family: string): string {
  return family.trim().toLocaleLowerCase('en-US');
}

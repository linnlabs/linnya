import type {
  FontFamilyCandidate,
  FontFamilyCheckResult,
  FontFamilyListRequest,
  FontFamilyListResult,
  FontFamilyStyle,
} from '../definitions/fontCatalogQuery.js';
import type { FontMetadata, ScriptClass } from '../definitions/types.js';
import {
  hasScriptCoverage,
  isPublicFontFamily,
} from '../functions/scriptCoverage.js';

const SCRIPT_ORDER: readonly ScriptClass[] = ['latin', 'eastAsian', 'complex'];
const STYLE_ORDER: readonly FontFamilyStyle[] = ['regular', 'bold', 'italic'];
const MAX_PAGE_SIZE = 100;

export interface FontCatalogQueryPort {
  waitUntilReady(): Promise<void>;
  findByFamily(family: string): readonly FontMetadata[];
  allFonts(): readonly FontMetadata[];
}

export class FontCatalogQueryService {
  constructor(private catalog: FontCatalogQueryPort) {}

  configureCatalog(catalog: FontCatalogQueryPort): void {
    this.catalog = catalog;
  }

  async checkFamily(family: string): Promise<FontFamilyCheckResult> {
    await this.catalog.waitUntilReady();
    const requestedFamily = family.trim();
    if (!requestedFamily) {
      throw new RangeError('Font family name must be non-empty');
    }
    const fonts = this.catalog.findByFamily(requestedFamily);
    if (fonts.length === 0) {
      return { requestedFamily, installed: false };
    }
    return {
      requestedFamily,
      installed: true,
      match: summarizeFamily(fonts),
    };
  }

  async listFamilies(request: FontFamilyListRequest): Promise<FontFamilyListResult> {
    assertPagination(request);
    await this.catalog.waitUntilReady();

    const familiesByKey = new Map<string, FontMetadata[]>();
    for (const font of this.catalog.allFonts()) {
      if (!hasScriptCoverage(font, request.script)) continue;
      if (!isPublicFontFamily(font.family)) continue;
      const key = normalizeFamilyName(font.family);
      const familyFonts = familiesByKey.get(key);
      if (familyFonts) {
        familyFonts.push(font);
      } else {
        familiesByKey.set(key, [font]);
      }
    }

    const candidates = [...familiesByKey.values()]
      .map(summarizeFamily)
      .sort(compareFamilyCandidates);
    const families = candidates.slice(request.offset, request.offset + request.limit);

    return {
      ...request,
      total: candidates.length,
      hasMore: request.offset + families.length < candidates.length,
      families,
    };
  }
}

function summarizeFamily(fonts: readonly FontMetadata[]): FontFamilyCandidate {
  const family = [...new Set(fonts.map((font) => font.family.trim()))]
    .sort(compareStrings)[0];
  if (!family) {
    throw new Error('Font family metadata must contain a non-empty family name');
  }

  const scripts = SCRIPT_ORDER.filter((script) => (
    fonts.some((font) => hasScriptCoverage(font, script))
  ));
  const styles = STYLE_ORDER.filter((style) => fonts.some((font) => hasStyle(font, style)));

  return {
    family,
    scripts,
    styles,
    monospace: fonts.some((font) => font.isFixedPitch),
  };
}

function hasStyle(font: FontMetadata, style: FontFamilyStyle): boolean {
  if (style === 'bold') return font.bold;
  if (style === 'italic') return font.italic;
  return !font.bold && !font.italic;
}

function assertPagination(request: FontFamilyListRequest): void {
  if (!Number.isInteger(request.offset) || request.offset < 0) {
    throw new RangeError('Font family list offset must be a non-negative integer');
  }
  if (!Number.isInteger(request.limit) || request.limit <= 0 || request.limit > MAX_PAGE_SIZE) {
    throw new RangeError(`Font family list limit must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
}

function compareFamilyCandidates(first: FontFamilyCandidate, second: FontFamilyCandidate): number {
  const normalized = compareStrings(
    normalizeFamilyName(first.family),
    normalizeFamilyName(second.family),
  );
  return normalized === 0 ? compareStrings(first.family, second.family) : normalized;
}

function compareStrings(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

function normalizeFamilyName(family: string): string {
  return family.trim().toLocaleLowerCase('en-US');
}

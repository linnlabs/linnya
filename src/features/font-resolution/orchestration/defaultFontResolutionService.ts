import { resolveFontTextSegments } from '../functions/resolveFontTextSegments.js';
import type { FontMetadata, FontRequest, ResolvedFont, ScriptClass } from '../definitions/types.js';
import { FontResolutionService, type FontResolutionCatalog } from './FontResolutionService.js';

class UnreadyFontCatalog implements FontResolutionCatalog {
  isReady(): boolean {
    return false;
  }

  findByFamily(_family: string): readonly FontMetadata[] {
    return [];
  }

  candidatesForScript(_script: ScriptClass): readonly FontMetadata[] {
    return [];
  }
}

export const defaultFontResolutionService = new FontResolutionService({
  catalog: new UnreadyFontCatalog(),
});

export function configureDefaultFontResolutionService(options: {
  catalog: FontResolutionCatalog;
}): void {
  defaultFontResolutionService.configureCatalog(options.catalog);
}

export function resetDefaultFontResolutionService(): void {
  defaultFontResolutionService.configureCatalog(new UnreadyFontCatalog());
}

export function resolveFont(request: FontRequest): ResolvedFont {
  return defaultFontResolutionService.resolve(request);
}


export function resolveFontText(text: string, request: Omit<FontRequest, 'script' | 'requiredCodePoints'>) {
  return resolveFontTextSegments(text, request, resolveFont);
}

import { FontCatalogUnavailableError } from '../definitions/fontCatalogQuery.js';
import type { FontMetadata } from '../definitions/types.js';
import {
  FontCatalogQueryService,
  type FontCatalogQueryPort,
} from './FontCatalogQueryService.js';

class UnavailableFontCatalog implements FontCatalogQueryPort {
  async waitUntilReady(): Promise<void> {
    throw new FontCatalogUnavailableError();
  }

  findByFamily(_family: string): readonly FontMetadata[] {
    return [];
  }

  allFonts(): readonly FontMetadata[] {
    return [];
  }
}

const unavailableFontCatalog = new UnavailableFontCatalog();

export const defaultFontCatalogQueryService = new FontCatalogQueryService(
  unavailableFontCatalog,
);

export function configureDefaultFontCatalogQueryService(options: {
  readonly catalog: FontCatalogQueryPort;
}): void {
  defaultFontCatalogQueryService.configureCatalog(options.catalog);
}

export function resetDefaultFontCatalogQueryService(): void {
  defaultFontCatalogQueryService.configureCatalog(unavailableFontCatalog);
}

export const checkFontFamily = defaultFontCatalogQueryService.checkFamily.bind(
  defaultFontCatalogQueryService,
);

export const listFontFamilies = defaultFontCatalogQueryService.listFamilies.bind(
  defaultFontCatalogQueryService,
);

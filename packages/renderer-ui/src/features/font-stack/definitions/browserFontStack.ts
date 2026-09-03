export interface BrowserFontStackResolution {
  readonly requestedFamily?: string;
  readonly requestedPrimaryFamily?: string;
  readonly primaryFamily: string;
  readonly resolvedFamily: string;
  readonly fallbackFamilies: readonly string[];
}

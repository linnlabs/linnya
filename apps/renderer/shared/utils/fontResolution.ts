import {
  formatCssFontFamilyStack,
  resolveBrowserFontStack,
} from '@linnya/renderer-ui/font-stack';

export interface FontResolution {
  requestedFamily?: string;
  primaryFamily: string;
  resolvedFamily: string;
  requestedAvailable: boolean;
  resolvedPrimaryAvailable: boolean;
  fallbackFamilies: string[];
}

export interface FontResolutionOptions {
  sampleText?: string;
}

const availabilityCache = new Map<string, boolean>();
const reportedFallbacks = new Set<string>();

export function resolveRendererFont(
  requestedFamily?: string,
  options: FontResolutionOptions = {},
): FontResolution {
  const stack = resolveBrowserFontStack(requestedFamily, options.sampleText);
  const requestedPrimaryFamily = stack.requestedPrimaryFamily;
  const fallbackFamilies = [...stack.fallbackFamilies];
  const runtimeDetectionAvailable = canDetectRuntimeFonts();
  const requestedAvailable = requestedPrimaryFamily == null
    ? false
    : (runtimeDetectionAvailable ? isFontFamilyAvailable(requestedPrimaryFamily) : true);
  const resolvedPrimaryFamily = runtimeDetectionAvailable
    ? (
      fallbackFamilies.find((family) => isFontFamilyAvailable(family))
      ?? fallbackFamilies[0]
      ?? 'sans-serif'
    )
    : (
      requestedPrimaryFamily
      ?? fallbackFamilies[0]
      ?? 'sans-serif'
    );
  const resolvedFamily = formatCssFontFamilyStack([
    resolvedPrimaryFamily,
    ...fallbackFamilies.filter(family => family !== resolvedPrimaryFamily),
  ]);
  const result: FontResolution = {
    requestedFamily: stack.requestedFamily,
    primaryFamily: resolvedPrimaryFamily,
    resolvedFamily,
    requestedAvailable,
    resolvedPrimaryAvailable: runtimeDetectionAvailable ? isFontFamilyAvailable(resolvedPrimaryFamily) : true,
    fallbackFamilies,
  };

  reportFontFallbackOnce(result);
  return result;
}

export function resolveRendererFontFamily(
  requestedFamily?: string,
  options: FontResolutionOptions = {},
): string {
  return resolveRendererFont(requestedFamily, options).resolvedFamily;
}

export function isFontFamilyAvailable(fontFamily: string): boolean {
  const normalizedFamily = stripQuotes(fontFamily.trim());
  if (normalizedFamily.length === 0 || normalizedFamily === 'sans-serif' || normalizedFamily === 'serif' || normalizedFamily === 'monospace') {
    return true;
  }

  const cached = availabilityCache.get(normalizedFamily);
  if (cached != null) {
    return cached;
  }

  const available = detectFontAvailability(normalizedFamily);
  availabilityCache.set(normalizedFamily, available);
  return available;
}

function stripQuotes(fontFamily: string): string {
  return fontFamily.replace(/^['"]|['"]$/g, '');
}

function detectFontAvailability(fontFamily: string): boolean {
  if (!canDetectRuntimeFonts()) {
    return false;
  }

  if ('fonts' in document && document.fonts.check(`12px "${fontFamily}"`)) {
    return true;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context == null) {
    return false;
  }

  const sample = 'abcdefghijklmnopqrstuvwxyz0123456789';
  context.font = '12px monospace';
  const baselineWidth = context.measureText(sample).width;
  context.font = `12px "${fontFamily}", monospace`;
  const measuredWidth = context.measureText(sample).width;
  return measuredWidth !== baselineWidth;
}

function canDetectRuntimeFonts(): boolean {
  return typeof document !== 'undefined';
}

function reportFontFallbackOnce(resolution: FontResolution): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (resolution.requestedFamily == null) {
    return;
  }
  if (resolution.requestedAvailable && resolution.primaryFamily === stripQuotes(resolution.requestedFamily)) {
    return;
  }

  const reportKey = `${resolution.requestedFamily}=>${resolution.primaryFamily}`;
  if (reportedFallbacks.has(reportKey)) {
    return;
  }
  reportedFallbacks.add(reportKey);

  console.debug('[FontResolution] Renderer font fallback applied.', {
    requestedFamily: resolution.requestedFamily,
    requestedAvailable: resolution.requestedAvailable,
    resolvedPrimaryFamily: resolution.primaryFamily,
    resolvedFamily: resolution.resolvedFamily,
  });
}

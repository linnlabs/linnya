const SLIDES_DEBUG_STORAGE_KEY = 'linnya.slides.debug';

function readSlidesDebugStorageValue(): string | null {
  try {
    return globalThis.localStorage?.getItem(SLIDES_DEBUG_STORAGE_KEY) ?? null;
  } catch {
    return 'unavailable';
  }
}

export function isSlidesVerboseDiagnosticLoggingEnabled(): boolean {
  if (import.meta.env.MODE === 'test') {
    return false;
  }
  return readSlidesDebugStorageValue() === 'verbose';
}

export function logSlidesVerbose(
  scope: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (!isSlidesVerboseDiagnosticLoggingEnabled()) {
    return;
  }

  console.debug(`slides.${diagnosticArea(scope)}.trace`, { message, ...details });
}

export function warnSlides(
  scope: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  console.warn(`slides.${diagnosticArea(scope)}.warning`, { message, ...details });
}

function diagnosticArea(scope: string): string {
  return scope.replace(/([a-z])([A-Z])/gu, '$1_$2').toLowerCase();
}

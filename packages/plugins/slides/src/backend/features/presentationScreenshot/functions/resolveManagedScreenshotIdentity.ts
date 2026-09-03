import { createHash } from 'node:crypto';
import type {
  PresentationScreenshotEncoding,
  PresentationScreenshotProfileInput,
  PresentationScreenshotSourceIdentity,
} from '../definitions/presentationScreenshot';

export interface ManagedScreenshotIdentity {
  readonly versionDirectoryName: string;
  readonly profileDirectoryName: string;
}

export function resolveManagedScreenshotIdentity(input: {
  readonly source: PresentationScreenshotSourceIdentity;
  readonly profile: PresentationScreenshotProfileInput;
  readonly encoding: PresentationScreenshotEncoding;
}): ManagedScreenshotIdentity {
  return {
    versionDirectoryName: `version-${String(input.source.versionNumber).padStart(12, '0')}-${shortHash(input.source.versionId, 12)}`,
    profileDirectoryName: `profile-${shortHash(JSON.stringify({
      id: input.profile.id,
      viewportWidthPx: input.profile.viewportWidthPx,
      pixelRatio: input.profile.pixelRatio,
      encoding: input.encoding.kind,
    }), 16)}`,
  };
}

export function parseManagedScreenshotVersionNumber(
  directoryName: string,
): number | undefined {
  const match = /^version-(\d{12})-[a-f0-9]{12}$/.exec(directoryName);
  if (!match) return undefined;
  const versionNumber = Number(match[1]);
  return Number.isSafeInteger(versionNumber) ? versionNumber : undefined;
}

function shortHash(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

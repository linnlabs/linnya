import fs from 'node:fs';
import path from 'node:path';

import {
  createCommunityDistributionIdentity,
  createSourceDistributionIdentity,
} from '../../../shared/distribution-identity';
import {
  DESKTOP_DISTRIBUTION_MANIFEST_FILE_NAME,
  type DesktopDistributionResolution,
  type TrustedDesktopDistributionKeys,
} from '../definitions/desktopDistributionManifest';
import { verifyDesktopDistributionManifest } from '../functions/verifyDesktopDistributionManifest';
import { trustedDesktopDistributionKeys } from '../registry/trustedDesktopDistributionKeys';

export function resolveElectronDistributionIdentity(input: {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly applicationVersion: string;
  readonly trustedKeys?: TrustedDesktopDistributionKeys;
  readonly readManifest?: (manifestPath: string) => string;
}): DesktopDistributionResolution {
  if (!input.packaged) {
    return Object.freeze({
      identity: createSourceDistributionIdentity(),
      evidence: 'source-runtime',
    });
  }

  const manifestPath = path.join(input.resourcesPath, DESKTOP_DISTRIBUTION_MANIFEST_FILE_NAME);
  let manifestText: string;
  try {
    manifestText = (input.readManifest ?? readManifestFile)(manifestPath);
  } catch (error: unknown) {
    if (readErrorCode(error) === 'ENOENT') {
      return Object.freeze({
        identity: createCommunityDistributionIdentity(),
        evidence: 'manifest-absent',
      });
    }
    return Object.freeze({
      identity: createCommunityDistributionIdentity(),
      evidence: 'invalid-manifest',
      diagnostic: errorMessage(error),
    });
  }

  try {
    return Object.freeze({
      identity: verifyDesktopDistributionManifest({
        manifestText,
        applicationVersion: input.applicationVersion,
        trustedKeys: input.trustedKeys ?? trustedDesktopDistributionKeys,
      }),
      evidence: 'verified-manifest',
    });
  } catch (error: unknown) {
    return Object.freeze({
      identity: createCommunityDistributionIdentity(),
      evidence: 'invalid-manifest',
      diagnostic: errorMessage(error),
    });
  }
}

function readManifestFile(manifestPath: string): string {
  return fs.readFileSync(manifestPath, 'utf8');
}

function readErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

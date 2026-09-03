import type { DistributionIdentity } from '../../../shared/distribution-identity';

export const DESKTOP_DISTRIBUTION_MANIFEST_FILE_NAME = 'desktop-distribution.json';
export const DESKTOP_DISTRIBUTION_ENVELOPE_SCHEMA_VERSION = 1 as const;
export const DESKTOP_DISTRIBUTION_PAYLOAD_SCHEMA_VERSION = 1 as const;
export const LINNYA_DESKTOP_APPLICATION_ID = 'com.skysiix.Linnya' as const;

export interface DesktopDistributionManifestEnvelope {
  readonly schema_version: typeof DESKTOP_DISTRIBUTION_ENVELOPE_SCHEMA_VERSION;
  readonly key_id: string;
  readonly payload: string;
  readonly signature: string;
}

export interface DesktopDistributionManifestPayload {
  readonly schema_version: typeof DESKTOP_DISTRIBUTION_PAYLOAD_SCHEMA_VERSION;
  readonly application_id: typeof LINNYA_DESKTOP_APPLICATION_ID;
  readonly application_version: string;
  readonly distribution: 'official';
  readonly release_channel: 'stable' | 'beta';
}

export type TrustedDesktopDistributionKeys = Readonly<Record<string, string>>;

export type DesktopDistributionResolution = Readonly<{
  identity: DistributionIdentity;
  evidence:
    | 'source-runtime'
    | 'manifest-absent'
    | 'verified-manifest'
    | 'invalid-manifest';
  diagnostic?: string;
}>;

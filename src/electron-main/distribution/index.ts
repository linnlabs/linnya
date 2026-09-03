export type {
  DesktopDistributionManifestEnvelope,
  DesktopDistributionManifestPayload,
  DesktopDistributionResolution,
  TrustedDesktopDistributionKeys,
} from './definitions/desktopDistributionManifest';
export {
  DESKTOP_DISTRIBUTION_ENVELOPE_SCHEMA_VERSION,
  DESKTOP_DISTRIBUTION_MANIFEST_FILE_NAME,
  DESKTOP_DISTRIBUTION_PAYLOAD_SCHEMA_VERSION,
  LINNYA_DESKTOP_APPLICATION_ID,
} from './definitions/desktopDistributionManifest';
export { verifyDesktopDistributionManifest } from './functions/verifyDesktopDistributionManifest';
export { resolveElectronDistributionIdentity } from './orchestration/resolveElectronDistributionIdentity';

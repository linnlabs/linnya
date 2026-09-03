export type {
  DesktopReleaseChannel,
  DistributionIdentity,
} from './definitions/distributionIdentity';
export { DESKTOP_RELEASE_CHANNELS } from './definitions/distributionIdentity';
export {
  createCommunityDistributionIdentity,
  createDistributionIdentity,
  createOfficialDistributionIdentity,
  createSourceDistributionIdentity,
} from './functions/createDistributionIdentity';
export {
  installDistributionIdentity,
  readInstalledDistributionIdentity,
  requireInstalledDistributionIdentity,
} from './registry/distributionIdentityRegistry';

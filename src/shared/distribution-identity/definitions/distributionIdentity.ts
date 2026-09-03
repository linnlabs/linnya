export const DESKTOP_RELEASE_CHANNELS = ['stable', 'beta'] as const;

export type DesktopReleaseChannel = (typeof DESKTOP_RELEASE_CHANNELS)[number];

export type DistributionIdentity =
  | Readonly<{
      kind: 'source';
      packaged: false;
    }>
  | Readonly<{
      kind: 'community';
      packaged: true;
    }>
  | Readonly<{
      kind: 'official';
      packaged: true;
      releaseChannel: DesktopReleaseChannel;
      releaseKeyId: string;
    }>;

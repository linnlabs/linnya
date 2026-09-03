import {
  DESKTOP_RELEASE_CHANNELS,
  type DesktopReleaseChannel,
  type DistributionIdentity,
} from '../definitions/distributionIdentity';

export type DistributionIdentityInput =
  | Readonly<{ kind: 'source'; packaged: boolean }>
  | Readonly<{ kind: 'community'; packaged: boolean }>
  | Readonly<{
      kind: 'official';
      packaged: boolean;
      releaseChannel: DesktopReleaseChannel;
      releaseKeyId: string;
    }>;

export function createSourceDistributionIdentity(): DistributionIdentity {
  return Object.freeze({ kind: 'source', packaged: false });
}

export function createCommunityDistributionIdentity(): DistributionIdentity {
  return Object.freeze({ kind: 'community', packaged: true });
}

export function createOfficialDistributionIdentity(input: {
  readonly releaseChannel: DesktopReleaseChannel;
  readonly releaseKeyId: string;
}): DistributionIdentity {
  if (!DESKTOP_RELEASE_CHANNELS.includes(input.releaseChannel)) {
    throw new Error(`不支持的 Desktop release channel: ${input.releaseChannel}`);
  }
  const releaseKeyId = input.releaseKeyId.trim();
  if (!releaseKeyId) throw new Error('Desktop official distribution 缺少 release key ID');
  return Object.freeze({
    kind: 'official',
    packaged: true,
    releaseChannel: input.releaseChannel,
    releaseKeyId,
  });
}

export function createDistributionIdentity(input: DistributionIdentityInput): DistributionIdentity {
  switch (input.kind) {
    case 'source':
      if (input.packaged) throw new Error('source distribution 不能标记为 packaged');
      return createSourceDistributionIdentity();
    case 'community':
      if (!input.packaged) throw new Error('community distribution 必须标记为 packaged');
      return createCommunityDistributionIdentity();
    case 'official':
      if (!input.packaged) throw new Error('official distribution 必须标记为 packaged');
      return createOfficialDistributionIdentity(input);
  }
}

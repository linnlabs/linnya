import { verify } from 'node:crypto';

import { z } from 'zod';

import {
  createOfficialDistributionIdentity,
  type DistributionIdentity,
} from '../../../shared/distribution-identity';
import {
  DESKTOP_DISTRIBUTION_ENVELOPE_SCHEMA_VERSION,
  DESKTOP_DISTRIBUTION_PAYLOAD_SCHEMA_VERSION,
  LINNYA_DESKTOP_APPLICATION_ID,
  type TrustedDesktopDistributionKeys,
} from '../definitions/desktopDistributionManifest';

const CanonicalBase64Schema = z.string().min(1).refine(value => {
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
}, '必须是 canonical base64');

const EnvelopeSchema = z.object({
  schema_version: z.literal(DESKTOP_DISTRIBUTION_ENVELOPE_SCHEMA_VERSION),
  key_id: z.string().min(1),
  payload: CanonicalBase64Schema,
  signature: CanonicalBase64Schema,
}).strict();

const PayloadSchema = z.object({
  schema_version: z.literal(DESKTOP_DISTRIBUTION_PAYLOAD_SCHEMA_VERSION),
  application_id: z.literal(LINNYA_DESKTOP_APPLICATION_ID),
  application_version: z.string().min(1),
  distribution: z.literal('official'),
  release_channel: z.enum(['stable', 'beta']),
}).strict();

/** 对 envelope 中的原始 payload bytes 验签成功后，才把 payload 解析成官方身份。 */
export function verifyDesktopDistributionManifest(input: {
  readonly manifestText: string;
  readonly applicationVersion: string;
  readonly trustedKeys: TrustedDesktopDistributionKeys;
}): DistributionIdentity {
  const envelope = EnvelopeSchema.parse(JSON.parse(input.manifestText));
  const publicKey = input.trustedKeys[envelope.key_id];
  if (!publicKey) throw new Error(`Desktop distribution key 不受信任: ${envelope.key_id}`);

  const payloadBytes = Buffer.from(envelope.payload, 'base64');
  const signatureBytes = Buffer.from(envelope.signature, 'base64');
  if (!verify(null, payloadBytes, publicKey, signatureBytes)) {
    throw new Error('Desktop distribution manifest 签名无效');
  }

  const payload = PayloadSchema.parse(JSON.parse(payloadBytes.toString('utf8')));
  if (payload.application_version !== input.applicationVersion) {
    throw new Error(
      `Desktop distribution manifest 版本不匹配: expected=${input.applicationVersion} actual=${payload.application_version}`
    );
  }
  return createOfficialDistributionIdentity({
    releaseChannel: payload.release_channel,
    releaseKeyId: envelope.key_id,
  });
}

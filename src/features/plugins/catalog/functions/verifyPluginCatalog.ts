import { createHash, verify } from 'node:crypto';

import {
  SignedPluginCatalogPayloadSchema,
  type PluginCatalogChannel,
  type PluginCatalogRevocation,
  type SignedPluginCatalogPayload,
} from '@app/schemas';
import { z } from 'zod';

import {
  PLUGIN_CATALOG_ENVELOPE_SCHEMA_VERSION,
  PluginCatalogRejectedError,
  type PluginCatalogHighWaterMark,
  type TrustedPluginCatalogKeys,
  type VerifiedPluginCatalog,
} from '../definitions/pluginCatalog';

/** 发布时钟与用户时钟允许的偏差；超过即视为尚未生效。 */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** 单份 catalog 的最长有效期；限制被截获旧 catalog 的可回放窗口。 */
const MAX_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

const CanonicalBase64 = z.string().min(1).refine(value => {
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
}, 'must be canonical base64');

const EnvelopeSchema = z.object({
  schemaVersion: z.literal(PLUGIN_CATALOG_ENVELOPE_SCHEMA_VERSION),
  keyId: z.string().min(1),
  payload: CanonicalBase64,
  signature: CanonicalBase64,
}).strict();

function isAllowedArtifactUrl(value: string, allowLoopbackHttp: boolean): boolean {
  const url = new URL(value);
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  // 只给开发/测试组合显式打开本机 HTTP；official 生产组合不传该选项。
  return allowLoopbackHttp && url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
}

function assertUnique(keys: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new PluginCatalogRejectedError('malformed', `${label} 重复: ${key}`);
    seen.add(key);
  }
}

function isRevoked(revoked: readonly PluginCatalogRevocation[], kind: PluginCatalogRevocation['kind'], id: string, version: string): boolean {
  return revoked.some(item => item.kind === kind && item.id === id && item.version === version);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * 先对原始 payload bytes 验签，成功后才解析 payload；随后检查地址、通道、有效期与回放。
 * 任一检查失败都抛出 PluginCatalogRejectedError，调用方必须失败关闭并保留原有安装。
 */
export function verifyPluginCatalog(input: {
  readonly catalogText: string;
  readonly trustedKeys: TrustedPluginCatalogKeys;
  readonly expectedChannel: PluginCatalogChannel;
  readonly now: Date;
  readonly highWaterMark?: PluginCatalogHighWaterMark | null;
  readonly allowLoopbackHttp?: boolean;
}): VerifiedPluginCatalog {
  let envelope: z.infer<typeof EnvelopeSchema>;
  try {
    envelope = EnvelopeSchema.parse(JSON.parse(input.catalogText));
  } catch (error) {
    throw new PluginCatalogRejectedError('malformed', 'Plugin catalog 信封格式无效', { cause: error });
  }
  const publicKey = input.trustedKeys[envelope.keyId];
  if (!publicKey) throw new PluginCatalogRejectedError('untrusted-key', `Plugin catalog key 不受信任: ${envelope.keyId}`);

  const payloadBytes = Buffer.from(envelope.payload, 'base64');
  const signatureBytes = Buffer.from(envelope.signature, 'base64');
  let signatureValid = false;
  try {
    signatureValid = verify(null, payloadBytes, publicKey, signatureBytes);
  } catch (error) {
    throw new PluginCatalogRejectedError('bad-signature', 'Plugin catalog 签名无法校验', { cause: error });
  }
  if (!signatureValid) throw new PluginCatalogRejectedError('bad-signature', 'Plugin catalog 签名无效');

  let payload: SignedPluginCatalogPayload;
  try {
    payload = SignedPluginCatalogPayloadSchema.parse(JSON.parse(payloadBytes.toString('utf8')));
  } catch (error) {
    throw new PluginCatalogRejectedError('malformed', 'Plugin catalog 内容无效', { cause: error });
  }

  const allowLoopbackHttp = input.allowLoopbackHttp === true;
  const urls = [
    ...payload.plugins.map(entry => entry.artifactUrl),
    ...payload.runtimes.flatMap(entry => entry.targets.map(target => target.artifactUrl)),
  ];
  const insecure = urls.find(url => !isAllowedArtifactUrl(url, allowLoopbackHttp));
  if (insecure !== undefined) {
    throw new PluginCatalogRejectedError('insecure-url', `Plugin catalog 下载地址必须使用 https: ${insecure}`);
  }

  if (payload.channel !== input.expectedChannel) {
    throw new PluginCatalogRejectedError('wrong-channel', `Plugin catalog 通道不匹配: expected=${input.expectedChannel} actual=${payload.channel}`);
  }
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_MS) {
    throw new PluginCatalogRejectedError('malformed', 'Plugin catalog 有效期无效');
  }
  const now = input.now.getTime();
  if (now + CLOCK_SKEW_MS < issuedAt) throw new PluginCatalogRejectedError('not-yet-valid', 'Plugin catalog 尚未生效');
  if (now >= expiresAt) throw new PluginCatalogRejectedError('expired', 'Plugin catalog 已过期');

  const digest = createHash('sha256').update(payloadBytes).digest('hex');
  const mark = input.highWaterMark;
  if (mark && (payload.sequence < mark.sequence || (payload.sequence === mark.sequence && digest !== mark.digest))) {
    throw new PluginCatalogRejectedError('rollback', `Plugin catalog 序号回退或同序号内容不同: sequence=${payload.sequence} known=${mark.sequence}`);
  }

  assertUnique(payload.plugins.map(entry => `${entry.id}@${entry.version}`), '插件版本');
  assertUnique(payload.runtimes.map(entry => `${entry.id}@${entry.version}`), '运行时版本');
  for (const runtime of payload.runtimes) {
    assertUnique(runtime.targets.map(target => `${target.platform}/${target.architecture}`), `${runtime.id}@${runtime.version} 平台`);
  }

  return deepFreeze({
    keyId: envelope.keyId,
    digest,
    channel: payload.channel,
    sequence: payload.sequence,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    plugins: payload.plugins.filter(entry => !isRevoked(payload.revoked, 'plugin', entry.id, entry.version)),
    runtimes: payload.runtimes.filter(entry => !isRevoked(payload.revoked, 'runtime', entry.id, entry.version)),
    revoked: payload.revoked,
  });
}

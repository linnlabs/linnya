import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/** 测试用发布方：临时 Ed25519 密钥签名 catalog；生产私钥只在 linnya-release。 */
export function createTestCatalogPublisher(keyId = 'linnya-plugins-test'): {
  readonly keyId: string;
  readonly trustedKeys: Readonly<Record<string, string>>;
  readonly sign: (payload: unknown) => string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    keyId,
    trustedKeys: { [keyId]: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    sign: payload => signCatalog(payload, privateKey, keyId),
  };
}

export function signCatalog(payload: unknown, privateKey: KeyObject, keyId: string): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return JSON.stringify({
    schemaVersion: 1,
    keyId,
    payload: payloadBytes.toString('base64'),
    signature: sign(null, payloadBytes, privateKey).toString('base64'),
  });
}

export function catalogPlugin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const version = (overrides.version as string | undefined) ?? '0.2.0';
  return {
    id: 'knowledge',
    name: '知识库',
    version,
    developer: 'Linnya',
    description: '管理资料、检索知识并在项目中关联使用。',
    artifactUrl: `https://download.linnya.com/plugins/artifacts/knowledge/${version}/knowledge-${version}.zip`,
    sha512: 'a'.repeat(128),
    size: 12_000_000,
    requiresRuntimes: [],
    ...overrides,
  };
}

export function catalogRuntime(version: string, targets: readonly { platform: string; architecture: string }[]): Record<string, unknown> {
  return {
    id: 'qdrant',
    version,
    targets: targets.map(target => ({
      ...target,
      artifactUrl: `https://download.linnya.com/plugins/runtimes/qdrant/${version}/${target.platform}-${target.architecture}.zip`,
      sha512: 'b'.repeat(128),
      size: 25_000_000,
      executable: target.platform === 'win32' ? 'qdrant.exe' : 'qdrant',
      executableSha256: 'c'.repeat(64),
    })),
  };
}

export function catalogPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    channel: 'stable',
    sequence: 1,
    issuedAt: '2026-11-21T00:00:00.000Z',
    expiresAt: '2026-12-21T00:00:00.000Z',
    plugins: [catalogPlugin()],
    runtimes: [],
    revoked: [],
    ...overrides,
  };
}

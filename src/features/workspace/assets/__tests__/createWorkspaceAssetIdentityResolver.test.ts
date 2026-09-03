import { describe, expect, it } from 'vitest';
import { createWorkspaceAssetIdentityResolver } from '../functions/createWorkspaceAssetIdentityResolver';

class AssetIdentityDatabaseFake {
  readonly persistedByUri = new Map<string, string>();

  prepare(_sql: string): { get: (uri: unknown) => unknown } {
    return {
      get: (uri: unknown): unknown => (
        typeof uri === 'string' && this.persistedByUri.has(uri)
          ? { id: this.persistedByUri.get(uri) }
          : undefined
      ),
    };
  }
}

describe('createWorkspaceAssetIdentityResolver', () => {
  it('优先复用 DB canonical ID，并让同 URI 的并发候选收敛到同一 UUID', () => {
    const db = new AssetIdentityDatabaseFake();
    db.persistedByUri.set('/Resources/Attachments/aa/existing.png', 'asset-existing');
    const generatedIds = ['asset-candidate-a', 'asset-candidate-b'];
    const resolver = createWorkspaceAssetIdentityResolver({
      db,
      createAssetId: () => generatedIds.shift() ?? 'asset-extra',
    });

    expect(resolver.resolveCanonicalAssetId('/Resources/Attachments/aa/existing.png'))
      .toBe('asset-existing');
    expect(resolver.resolveCanonicalAssetId('/Resources/Attachments/bb/new.png'))
      .toBe('asset-candidate-a');
    expect(resolver.resolveCanonicalAssetId('/Resources/Attachments/bb/new.png'))
      .toBe('asset-candidate-a');
    expect(resolver.resolveCanonicalAssetId('/Resources/Attachments/cc/other.png'))
      .toBe('asset-candidate-b');

    db.persistedByUri.set('/Resources/Attachments/bb/new.png', 'asset-db-winner');
    expect(resolver.resolveCanonicalAssetId('/Resources/Attachments/bb/new.png'))
      .toBe('asset-db-winner');
  });
});

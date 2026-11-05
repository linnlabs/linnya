import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AssetStoragePathError,
  isAssetStoragePath,
  joinAssetStoragePath,
  resolveAssetStoragePath,
} from '../index';

const STORED = 'ConversationAttachments/v2/stores/0f81bb43-dd9a-49e4-a3a1-bfb3bbb13ea7/content/ab/'
  + `${'ab'.repeat(32)}.png`;

describe('asset storage path', () => {
  it('只接受相对、以 / 分隔、没有空段和点段的受管路径', () => {
    expect(isAssetStoragePath(STORED)).toBe(true);
    for (const invalid of [
      '',
      '/ConversationAttachments/v2/a.png',
      'C:/ConversationAttachments/a.png',
      'ConversationAttachments\\v2\\a.png',
      'ConversationAttachments//a.png',
      'ConversationAttachments/./a.png',
      'ConversationAttachments/../a.png',
      '..',
      'ConversationAttachments/a.png/',
      'ConversationAttachments/附件.png',
      'ConversationAttachments/a b.png',
    ]) {
      expect(isAssetStoragePath(invalid), invalid).toBe(false);
    }
  });

  it('按当前 AppData Root 解析，拼接时拒绝越界片段', () => {
    const appDataRoot = path.join(path.sep, 'srv', 'linnya');
    expect(resolveAssetStoragePath(appDataRoot, STORED)).toBe(path.join(appDataRoot, ...STORED.split('/')));
    expect(joinAssetStoragePath('ConversationAttachments', 'v2', 'stores')).toBe('ConversationAttachments/v2/stores');
    expect(() => joinAssetStoragePath('ConversationAttachments', '..', 'outside.png'))
      .toThrow(AssetStoragePathError);
    expect(() => resolveAssetStoragePath(appDataRoot, path.join(appDataRoot, 'a.png')))
      .toThrow(AssetStoragePathError);
  });
});

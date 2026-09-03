import { describe, expect, it } from 'vitest';
import { resolveImageAsset, resolveImageSourceRef } from '../imageAssetResolver.js';

describe('imageAssetResolver', () => {
  describe('resolveImageSourceRef', () => {
    it('normalizes string URL/data-uri/absolute-path into source refs', () => {
      expect(resolveImageSourceRef('https://example.com/a.png')).toEqual({
        kind: 'external_url',
        url: 'https://example.com/a.png',
      });
      expect(resolveImageSourceRef('data:image/png;base64,AAAA')).toEqual({
        kind: 'data_uri',
        dataUri: 'data:image/png;base64,AAAA',
      });
      expect(resolveImageSourceRef('/tmp/hero.png')).toEqual({
        kind: 'local_path',
        path: '/tmp/hero.png',
      });
    });

    it('normalizes conversation-relative strings as generated asset references', () => {
      expect(resolveImageSourceRef('relative/path.png')).toEqual({
        kind: 'generated_asset',
        assetId: 'relative/path.png',
      });
    });
  });

  describe('resolveImageAsset', () => {
    it('resolves data URI and absolute local sources', () => {
      expect(
        resolveImageAsset({ kind: 'data_uri', dataUri: 'data:image/png;base64,AAAA' })
      ).toEqual({
        kind: 'data_uri',
        dataUri: 'data:image/png;base64,AAAA',
      });
      expect(resolveImageAsset({ kind: 'local_path', path: '/tmp/hero.png' })).toEqual({
        kind: 'local_file',
        path: '/tmp/hero.png',
      });
    });

    it('rejects remote URLs and tells the caller to download first', () => {
      expect(() =>
        resolveImageAsset({
          kind: 'external_url',
          url: 'https://example.com/a.png',
        })
      ).toThrow('Download the image to a local file first');
    });

    it('distinguishes invalid local paths from conversation file sources resolved by assembly', () => {
      expect(() => resolveImageAsset({ kind: 'local_path', path: 'relative/path.png' })).toThrow(
        /absolute/i
      );
      expect(() => resolveImageAsset({ kind: 'generated_asset', assetId: 'asset-1' })).toThrow(
        /generated_asset/i
      );
    });
  });
});

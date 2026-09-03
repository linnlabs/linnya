import { describe, expect, it } from 'vitest';
import {
  isDataUri,
  isExternalUrl,
  normalizeAssetRef,
} from '@plugin/slides/shared';

describe('AssetRef', () => {
  describe('isDataUri', () => {
    it('returns true for data URIs', () => {
      expect(isDataUri('data:image/png;base64,abc')).toBe(true);
    });
    it('returns false for non-data URIs', () => {
      expect(isDataUri('https://example.com/img.png')).toBe(false);
      expect(isDataUri('../media/image1.png')).toBe(false);
    });
  });

  describe('isExternalUrl', () => {
    it('returns true for http/https URLs', () => {
      expect(isExternalUrl('https://example.com/img.png')).toBe(true);
      expect(isExternalUrl('http://example.com/img.png')).toBe(true);
    });
    it('returns false for non-URLs', () => {
      expect(isExternalUrl('data:image/png;base64,abc')).toBe(false);
      expect(isExternalUrl('../media/image1.png')).toBe(false);
    });
  });

  describe('normalizeAssetRef', () => {
    it('returns undefined for undefined input', () => {
      expect(normalizeAssetRef(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(normalizeAssetRef('')).toBeUndefined();
    });

    it('normalizes data URI', () => {
      const ref = normalizeAssetRef('data:image/png;base64,abc');
      expect(ref).toEqual({ type: 'data', dataUri: 'data:image/png;base64,abc' });
    });

    it('normalizes external URL', () => {
      const ref = normalizeAssetRef('https://example.com/img.png');
      expect(ref).toEqual({ type: 'external', url: 'https://example.com/img.png' });
    });

    it('normalizes embedded part path', () => {
      const ref = normalizeAssetRef('../media/image1.png');
      expect(ref).toEqual({ type: 'embedded', partPath: '../media/image1.png' });
    });

    it('normalizes Windows-style path', () => {
      const ref = normalizeAssetRef('media\\image1.png');
      expect(ref).toEqual({ type: 'embedded', partPath: 'media\\image1.png' });
    });

    it('returns undefined for bare filename without path separator', () => {
      expect(normalizeAssetRef('image1.png')).toBeUndefined();
    });
  });
});

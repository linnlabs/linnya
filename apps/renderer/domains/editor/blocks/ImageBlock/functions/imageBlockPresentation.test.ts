import { describe, expect, it } from 'vitest';
import { getImageFormat } from './imageBlockPresentation';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';

const editorMessage: EditorMessageResolver = (key) => (
  key === 'editor.imageBlock.value.unknown' ? '未知' : key
);

function encodeMediaPath(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('imageBlockPresentation', () => {
  it('从 doc-image locator 的相对路径识别图片格式', () => {
    const locator = `media://load/doc-image/${encodeMediaPath('doc-1/example.png')}`;

    expect(getImageFormat(locator, editorMessage)).toBe('PNG');
  });
});

import { describe, expect, it } from 'vitest';
import { EDITOR_MESSAGE_CATALOG } from '../definitions/editorMessageCatalog';
import type { EditorMessageResolver } from '../definitions/editorMessages';
import { buildEditorMarkdownSerializerLabels } from './markdownSerializerLabels';

const enCatalog = EDITOR_MESSAGE_CATALOG.catalogs['en-US'];
const editorMessage: EditorMessageResolver = (key, params) => {
  const template = enCatalog[key];
  if (!params) return template;
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    template,
  );
};

describe('buildEditorMarkdownSerializerLabels', () => {
  it('builds localized labels for editor clipboard markdown placeholders', () => {
    const labels = buildEditorMarkdownSerializerLabels(editorMessage);

    expect(labels.bibliographyTitle).toBe('References');
    expect(labels.imageAlt).toBe('Image');
    expect(labels.imageDescription({ alt: 'Demo' })).toBe('[Image: Demo]');
    expect(labels.imageDescription({ alt: 'Demo', width: 320 })).toBe('[Image: Demo, width 320px]');
    expect(labels.imageDescription({ alt: 'Demo', height: 240 })).toBe('[Image: Demo, height 240px]');
    expect(labels.imageDescription({ alt: 'Demo', width: 320, height: 240 })).toBe(
      '[Image: Demo, width 320px, height 240px]',
    );
    expect(labels.audioFile).toBe('Audio file');
    expect(labels.emptyAudioBlock).toBe('Empty audio block');
  });
});

import type { MarkdownSerializerLabels } from '../../../shared/utils/markdownSerializer';
import type { EditorMessageResolver } from '../definitions/editorMessages';

export function buildEditorMarkdownSerializerLabels(
  editorMessage: EditorMessageResolver,
): MarkdownSerializerLabels {
  return {
    bibliographyTitle: editorMessage('editor.citation.bibliography.title'),
    imageAlt: editorMessage('editor.markdownSerializer.imageAlt'),
    imageDescription: ({ alt, width, height }) => {
      if (width && height) {
        return editorMessage('editor.markdownSerializer.imageDescriptionWithSize', {
          alt,
          width,
          height,
        });
      }
      if (width) {
        return editorMessage('editor.markdownSerializer.imageDescriptionWithWidth', {
          alt,
          width,
        });
      }
      if (height) {
        return editorMessage('editor.markdownSerializer.imageDescriptionWithHeight', {
          alt,
          height,
        });
      }
      return editorMessage('editor.markdownSerializer.imageDescription', { alt });
    },
    audioFile: editorMessage('editor.markdownSerializer.audioFile'),
    emptyAudioBlock: editorMessage('editor.markdownSerializer.emptyAudioBlock'),
  };
}

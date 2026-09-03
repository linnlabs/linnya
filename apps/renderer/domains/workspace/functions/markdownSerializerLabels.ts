import type { MarkdownSerializerLabels } from '../../../shared/utils/markdownSerializer';
import type { WorkspaceMessageResolver } from '../definitions/workspaceMessages';

export function buildWorkspaceMarkdownSerializerLabels(
  workspaceMessage: WorkspaceMessageResolver,
): MarkdownSerializerLabels {
  return {
    bibliographyTitle: workspaceMessage('workspace.export.markdownSerializer.bibliographyTitle'),
    imageAlt: workspaceMessage('workspace.export.markdownSerializer.imageAlt'),
    imageDescription: ({ alt, width, height }) => {
      if (width && height) {
        return workspaceMessage('workspace.export.markdownSerializer.imageDescriptionWithSize', {
          alt,
          width,
          height,
        });
      }
      if (width) {
        return workspaceMessage('workspace.export.markdownSerializer.imageDescriptionWithWidth', {
          alt,
          width,
        });
      }
      if (height) {
        return workspaceMessage('workspace.export.markdownSerializer.imageDescriptionWithHeight', {
          alt,
          height,
        });
      }
      return workspaceMessage('workspace.export.markdownSerializer.imageDescription', { alt });
    },
    audioFile: workspaceMessage('workspace.export.markdownSerializer.audioFile'),
    emptyAudioBlock: workspaceMessage('workspace.export.markdownSerializer.emptyAudioBlock'),
  };
}

import { broadcastRendererPluginMessage } from '@plugin/backend/pluginRendererPush';
import {
  SLIDES_PLUGIN_ID,
  SLIDES_PUSH_EVENTS,
  type PresentationImageExportProgress,
} from '@plugin/slides/shared';

export function reportPresentationImageExportProgress(
  progress: PresentationImageExportProgress,
): void {
  broadcastRendererPluginMessage(
    SLIDES_PLUGIN_ID,
    SLIDES_PUSH_EVENTS.imageExportProgress,
    { ...progress },
  );
}

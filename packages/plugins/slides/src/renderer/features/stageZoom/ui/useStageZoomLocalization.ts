import { useLocalization } from '@app/localization';
import {
  STAGE_ZOOM_MESSAGE_FALLBACKS,
  type StageZoomMessageResolver,
} from '../definitions/stageZoomMessageCatalog';

export function useStageZoomLocalization(): { readonly stageZoomMessage: StageZoomMessageResolver } {
  const { message } = useLocalization();
  return {
    stageZoomMessage: (key, params) => message(key, STAGE_ZOOM_MESSAGE_FALLBACKS[key], params),
  };
}

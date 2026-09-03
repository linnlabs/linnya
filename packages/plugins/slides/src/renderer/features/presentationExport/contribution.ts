import type {
  DocumentActionMenuContribution,
  DocumentActionMenuOptionValue,
} from '@plugin/renderer/pluginContribution';
import { SLIDES_ACTIVE_DOCUMENT_TYPE } from '@plugin/slides/shared/pluginMeta';
import {
  PRESENTATION_EXPORT_MENU_OPTIONS,
  resolvePresentationExportMenuFormat,
} from './functions/presentationExportOptions';
import { usePresentationExportStore } from './store/presentationExportStore';
import { useSlidesStore } from '../../store/slidesStore';

export const slidesDocumentActionMenu: DocumentActionMenuContribution = {
  activeDocumentType: SLIDES_ACTIVE_DOCUMENT_TYPE,
  tooltip: '更多菜单',
  ariaLabel: '演示文稿菜单',
  isAvailable: () => Boolean(useSlidesStore().currentDeckId),
  getOptions: () => PRESENTATION_EXPORT_MENU_OPTIONS,
  select(value: DocumentActionMenuOptionValue) {
    const format = resolvePresentationExportMenuFormat(value);
    if (format) {
      usePresentationExportStore().open(format);
    }
  },
};

import { registerSettingsContribution } from '@/domains/settings/public';
import EditorDocumentSettingsTab from '../ui/EditorDocumentSettingsTab.vue';

let registered = false;

export function ensureEditorDocumentSettingsContributionRegistered(): void {
  if (registered) return;

  registerSettingsContribution({
    id: 'editor-document',
    title: 'Text document',
    titleMessageKey: 'editor.documentSettings.tabTitle',
    group: 'document-types',
    order: 30,
    component: EditorDocumentSettingsTab,
  });

  registered = true;
}

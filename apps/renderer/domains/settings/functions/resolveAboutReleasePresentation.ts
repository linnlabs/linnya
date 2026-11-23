import type { SettingsMessageKey, SettingsMessageResolver } from '../definitions/settingsMessages';

export interface AboutReleaseSource {
  readonly version: string;
}

export interface AboutReleasePresentation {
  readonly title: string;
  readonly notes: readonly string[];
}

const ABOUT_RELEASE_NOTE_KEYS: readonly SettingsMessageKey[] = [
  'settings.about.release.note.scheduledTasks',
  'settings.about.release.note.pluginStore',
  'settings.about.release.note.knowledgePlugin',
  'settings.about.release.note.documentTabs',
  'settings.about.release.note.conversationControls',
  'settings.about.release.note.customModels',
  'settings.about.release.note.modelSetup',
];

export function resolveAboutReleasePresentation(
  release: AboutReleaseSource,
  settingsMessage: SettingsMessageResolver,
): AboutReleasePresentation {
  return {
    title: settingsMessage('settings.about.release.title', { version: release.version }),
    notes: ABOUT_RELEASE_NOTE_KEYS.map((key) => settingsMessage(key)),
  };
}

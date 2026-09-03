import type { SettingsMessageKey, SettingsMessageResolver } from '../definitions/settingsMessages';

export interface AboutReleaseSource {
  readonly version: string;
}

export interface AboutReleasePresentation {
  readonly title: string;
  readonly notes: readonly string[];
}

const ABOUT_RELEASE_NOTE_KEYS: readonly SettingsMessageKey[] = [
  'settings.about.release.note.pluginStore',
  'settings.about.release.note.mindmapRuntime',
  'settings.about.release.note.pluginState',
  'settings.about.release.note.pluginStoreUi',
  'settings.about.release.note.layoutFixes',
  'settings.about.release.note.defaultWorkspaceProtection',
  'settings.about.release.note.pluginDocs',
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

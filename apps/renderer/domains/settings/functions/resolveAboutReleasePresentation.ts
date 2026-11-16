import type { SettingsMessageKey, SettingsMessageResolver } from '../definitions/settingsMessages';

export interface AboutReleaseSource {
  readonly version: string;
}

export interface AboutReleasePresentation {
  readonly title: string;
  readonly notes: readonly string[];
}

const ABOUT_RELEASE_NOTE_KEYS: readonly SettingsMessageKey[] = [
  'settings.about.release.note.contextUsage',
  'settings.about.release.note.imageTools',
  'settings.about.release.note.projectOverview',
  'settings.about.release.note.slidesDesign',
  'settings.about.release.note.desktopReliability',
  'settings.about.release.note.pluginAvailability',
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

import { describe, expect, it } from 'vitest';
import { resolveAboutReleasePresentation } from './resolveAboutReleasePresentation';
import type { SettingsMessageResolver } from '../definitions/settingsMessages';

describe('resolveAboutReleasePresentation', () => {
  it('resolves release title and notes through the settings message resolver', () => {
    const resolver: SettingsMessageResolver = (key, params) => (
      key === 'settings.about.release.title'
        ? `Linnya v${params?.version ?? ''}`
        : key
    );

    const presentation = resolveAboutReleasePresentation({ version: '0.0.38' }, resolver);

    expect(presentation.title).toBe('Linnya v0.0.38');
    expect(presentation.notes).toEqual([
      'settings.about.release.note.contextUsage',
      'settings.about.release.note.imageTools',
      'settings.about.release.note.projectOverview',
      'settings.about.release.note.slidesDesign',
      'settings.about.release.note.desktopReliability',
      'settings.about.release.note.pluginAvailability',
      'settings.about.release.note.modelSetup',
    ]);
  });
});

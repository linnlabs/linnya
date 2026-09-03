import { describe, expect, it } from 'vitest';
import { resolveAboutReleasePresentation } from './resolveAboutReleasePresentation';
import type { SettingsMessageResolver } from '../definitions/settingsMessages';

describe('resolveAboutReleasePresentation', () => {
  it('resolves release title and notes through the settings message resolver', () => {
    const resolver: SettingsMessageResolver = (key, params) => (
      key === 'settings.about.release.title'
        ? `Beta v${params?.version ?? ''}`
        : key
    );

    const presentation = resolveAboutReleasePresentation({ version: '0.0.38' }, resolver);

    expect(presentation.title).toBe('Beta v0.0.38');
    expect(presentation.notes).toEqual([
      'settings.about.release.note.pluginStore',
      'settings.about.release.note.mindmapRuntime',
      'settings.about.release.note.pluginState',
      'settings.about.release.note.pluginStoreUi',
      'settings.about.release.note.layoutFixes',
      'settings.about.release.note.defaultWorkspaceProtection',
      'settings.about.release.note.pluginDocs',
    ]);
  });
});

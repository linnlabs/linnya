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
      'settings.about.release.note.scheduledTasks',
      'settings.about.release.note.pluginStore',
      'settings.about.release.note.knowledgePlugin',
      'settings.about.release.note.documentTabs',
      'settings.about.release.note.conversationControls',
      'settings.about.release.note.customModels',
      'settings.about.release.note.modelSetup',
    ]);
  });
});

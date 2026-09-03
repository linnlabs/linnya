import { describe, expect, it } from 'vitest';
import { buildModelSelectOptions } from './buildModelSelectOptions';
import type { SettingsModel } from '../definitions/modelSelectOptions';

const labels = {
  systemGroup: 'System',
  customGroup: 'Custom',
};

describe('buildModelSelectOptions', () => {
  it('groups system models before custom models with a separator', () => {
    const models: SettingsModel[] = [
      { id: 'sys-1', catalog_source: 'default', display_name: 'System One' },
      { id: 'account-1', catalog_source: 'account', display_name: 'Account One' },
      { id: 'custom-1', catalog_source: 'user', name: 'Custom One' },
    ];

    expect(buildModelSelectOptions({ models, labels })).toEqual([
      { isGroup: true, label: 'System' },
      { value: 'sys-1', text: 'System One' },
      { value: 'account-1', text: 'Account One' },
      { isSeparator: true },
      { isGroup: true, label: 'Custom' },
      { value: 'custom-1', text: 'Custom One' },
    ]);
  });

  it('uses model id when no display name is available', () => {
    expect(
      buildModelSelectOptions({
        models: [{ id: 'model-id', catalog_source: 'default' }],
        labels,
      })
    ).toEqual([
      { isGroup: true, label: 'System' },
      { value: 'model-id', text: 'model-id' },
    ]);
  });
});

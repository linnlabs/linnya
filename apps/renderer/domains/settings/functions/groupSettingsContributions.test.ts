import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import type {
  SettingsContribution,
  SettingsContributionGroup,
} from '../definitions/settingsContribution';
import {
  flattenSettingsNavigation,
  groupSettingsContributions,
} from './groupSettingsContributions';

const component = defineComponent({ template: '<div />' });

function contribution(
  id: string,
  group: SettingsContributionGroup,
  order: number,
  title = id,
): SettingsContribution {
  return { id, title, group, order, component };
}

describe('groupSettingsContributions', () => {
  it('按分组顺序输出，而不是按全局 order', () => {
    const groups = groupSettingsContributions([
      contribution('about', 'about', 90),
      contribution('model-config', 'models', 50),
      contribution('appearance', 'general', 10),
      contribution('editor-document', 'document-types', 30),
    ]);

    expect(groups.map((group) => group.group)).toEqual([
      'general',
      'models',
      'document-types',
      'about',
    ]);
  });

  it('组内按 order 排序，order 相同时按标题', () => {
    const groups = groupSettingsContributions([
      contribution('storage-space', 'general', 40),
      contribution('appearance', 'general', 10),
      contribution('b-tab', 'general', 20, 'B'),
      contribution('a-tab', 'general', 20, 'A'),
    ]);

    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      'appearance',
      'a-tab',
      'b-tab',
      'storage-space',
    ]);
  });

  it('省略空分组', () => {
    const groups = groupSettingsContributions([contribution('appearance', 'general', 10)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.group).toBe('general');
  });

  it('「关于」分组不带标题，避免与唯一条目重复', () => {
    const groups = groupSettingsContributions([
      contribution('appearance', 'general', 10),
      contribution('about', 'about', 90),
    ]);

    expect(groups[0]?.titleMessageKey).toBe('settings.groups.general');
    expect(groups[1]?.titleMessageKey).toBeNull();
  });

  it('契约外的分组落到兜底分组，而不是从导航里消失', () => {
    const rogue = {
      ...contribution('rogue-plugin', 'general', 15),
      group: 'totally-unknown' as SettingsContributionGroup,
    };

    const groups = groupSettingsContributions([
      contribution('appearance', 'general', 10),
      rogue,
    ]);

    const documentTypes = groups.find((group) => group.group === 'document-types');
    expect(documentTypes?.items.map((item) => item.id)).toEqual(['rogue-plugin']);
  });
});

describe('flattenSettingsNavigation', () => {
  it('按导航从上到下的视觉顺序展开 tab id', () => {
    const groups = groupSettingsContributions([
      contribution('about', 'about', 90),
      contribution('model-config', 'models', 50),
      contribution('appearance', 'general', 10),
      contribution('conversation', 'general', 20),
    ]);

    expect(flattenSettingsNavigation(groups)).toEqual([
      'appearance',
      'conversation',
      'model-config',
      'about',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { PluginStateView } from '@app/schemas';
import { buildPluginStoreList } from '../buildPluginStoreList';

describe('buildPluginStoreList', () => {
  it('只展示可管理插件', () => {
    const states: PluginStateView[] = [{
      meta: {
        id: 'platform',
        name: 'Linnya Platform',
        version: '1.0.0',
        description: 'Platform plugin',
        developer: 'Linnya',
        builtin: true,
        required: true,
      },
      state: 'enabled',
    }, {
      meta: {
        id: 'mindmap',
        name: 'Mindmap',
        version: '1.0.0',
        description: 'Mindmap plugin',
        developer: 'Linnya',
        builtin: true,
      },
      state: 'enabled',
    }];

    expect(buildPluginStoreList(states)).toEqual([states[1]]);
  });
});

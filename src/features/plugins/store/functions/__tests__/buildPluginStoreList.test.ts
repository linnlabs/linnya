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

  it('把随包来源作为 Host 事实投影给商店', () => {
    const states: PluginStateView[] = [{
      meta: {
        id: 'mindmap',
        name: 'Mindmap',
        version: '1.0.0',
        description: 'Mindmap plugin',
        developer: 'Linnya',
        builtin: true,
      },
      state: 'missing',
      reason: '用户已卸载该插件',
    }];

    expect(buildPluginStoreList(states, {
      bundledPluginIds: new Set(['mindmap']),
    })).toEqual([{
      ...states[0],
      bundledSourceAvailable: true,
    }]);
  });
});

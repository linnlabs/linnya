import { describe, expect, it } from 'vitest';

import type { AppServerRpcHandler } from '../definitions/appServerRpcPeer';
import { mergeAppServerRpcHandlerRegistries } from '../functions/mergeAppServerRpcHandlerRegistries';

const echo: AppServerRpcHandler = payload => payload;

describe('merge App Server RPC handler registries', () => {
  it('合并不同 capability 的显式方法', () => {
    const merged = mergeAppServerRpcHandlerRegistries([
      new Map([['desktop.credential.encrypt', echo]]),
      new Map([['desktop.authorization.open', echo]]),
    ]);

    expect([...merged.keys()]).toEqual([
      'desktop.credential.encrypt',
      'desktop.authorization.open',
    ]);
  });

  it('拒绝 method 冲突，不允许 composition 顺序改变能力 owner', () => {
    expect(() => mergeAppServerRpcHandlerRegistries([
      new Map([['desktop.credential.encrypt', echo]]),
      new Map([['desktop.credential.encrypt', echo]]),
    ])).toThrow('重复注册');
  });
});

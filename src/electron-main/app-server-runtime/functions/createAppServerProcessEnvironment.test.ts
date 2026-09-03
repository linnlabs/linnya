import { describe, expect, it } from 'vitest';

import { createAppServerProcessEnvironment } from './createAppServerProcessEnvironment';

describe('createAppServerProcessEnvironment', () => {
  it('只复制声明过的环境并排除 Electron/Node 启动注入', () => {
    expect(createAppServerProcessEnvironment({
      NODE_ENV: 'development',
      PATH: '/usr/bin',
      LINNYA_PLUGIN_ROOT: '/plugins',
      LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: '/workspace/private-plugin',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require=/tmp/inject.js',
      UNRELATED_SECRET: 'secret',
    })).toEqual({
      NODE_ENV: 'development',
      PATH: '/usr/bin',
      LINNYA_PLUGIN_ROOT: '/plugins',
      LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: '/workspace/private-plugin',
    });
  });
});

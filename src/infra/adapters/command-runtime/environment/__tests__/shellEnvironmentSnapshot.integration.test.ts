import { describe, expect, it } from 'vitest';

import {
  buildShellEnvironmentSnapshot,
  createHostProcessEnvironment,
  createMacOsLoginProbeHelperEnvironment,
  createUserLoginEnvironmentCandidate,
} from '..';

describe('Shell environment snapshot contracts', () => {
  it('登录候选覆盖同名启动值，同时保留 App 启动来源且冻结结果', () => {
    const mutableHost = {
      PATH: '/finder/path',
      HOST_ONLY: 'host-value',
      OMITTED: undefined,
    };
    const host = createHostProcessEnvironment(mutableHost);
    const candidateEntries = {
      PATH: '/login/path:/usr/bin',
      LOGIN_ONLY: '候选值',
    };
    const candidate = createUserLoginEnvironmentCandidate({
      source: 'macos_login_shell',
      entries: candidateEntries,
    });
    const snapshot = buildShellEnvironmentSnapshot({
      host,
      candidate,
      revision: 'app-owner-environment-1',
    });

    mutableHost.PATH = '/mutated-host';
    candidateEntries.PATH = '/mutated-candidate';
    expect(snapshot).toEqual({
      kind: 'shell_environment_snapshot',
      revision: 'app-owner-environment-1',
      source: 'macos_login_shell',
      entries: {
        PATH: '/login/path:/usr/bin',
        HOST_ONLY: 'host-value',
        LOGIN_ONLY: '候选值',
      },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
  });

  it('PATH 缺失时保留真实缺失事实，不制造隐藏 fallback', () => {
    const host = createHostProcessEnvironment({ HOME: '/Users/test' });
    const snapshot = buildShellEnvironmentSnapshot({
      host,
      candidate: createUserLoginEnvironmentCandidate({
        source: 'host_process',
        entries: host.entries,
      }),
      revision: 'app-owner-environment-2',
    });

    expect(snapshot.entries).toEqual({ HOME: '/Users/test' });
    expect(snapshot.entries).not.toHaveProperty('PATH');
  });

  it('App owner 捕获后新增的 Linnya 内部值不会进入命令快照', () => {
    const mutableProcessEnvironment = {
      PATH: '/user/path',
      USER_CLI_SESSION: 'user-session',
    };
    const host = createHostProcessEnvironment(mutableProcessEnvironment);

    Object.assign(mutableProcessEnvironment, {
      LINNYA_PLUGIN_ROOT: '/internal/plugins',
      MODEL_REGISTRY_DEFAULTS_PATH: '/internal/models.json',
    });
    const snapshot = buildShellEnvironmentSnapshot({
      host,
      candidate: createUserLoginEnvironmentCandidate({
        source: 'host_process',
        entries: host.entries,
      }),
      revision: 'app-owner-before-internal-mutation',
    });

    expect(snapshot.entries).toEqual({
      PATH: '/user/path',
      USER_CLI_SESSION: 'user-session',
    });
  });

  it('登录探针 helper 只继承身份和 locale，不继承可注入运行时代码的变量', () => {
    const helper = createMacOsLoginProbeHelperEnvironment(
      createHostProcessEnvironment({
        HOME: '/Users/test',
        USER: 'test',
        SHELL: '/bin/custom-shell',
        LANG: 'zh_CN.UTF-8',
        NODE_OPTIONS: '--require=/tmp/inject.cjs',
        PYTHONPATH: '/tmp/python-inject',
        BASH_ENV: '/tmp/bash-inject',
        ZDOTDIR: '/tmp/alternate-profile',
      }),
    );

    expect(helper.entries).toEqual({
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      SHELL: '/bin/custom-shell',
      TERM: 'dumb',
      HOME: '/Users/test',
      USER: 'test',
      LANG: 'zh_CN.UTF-8',
    });
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearPluginLifecycleSerialExecutorForTests,
  runPluginLifecycleOperationSerially,
} from './pluginLifecycleSerialExecutor';

describe('runPluginLifecycleOperationSerially', () => {
  afterEach(() => {
    clearPluginLifecycleSerialExecutorForTests();
  });

  it('同一插件的生命周期写操作按提交顺序串行执行', async () => {
    const events: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstBlocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runPluginLifecycleOperationSerially({
      pluginId: 'slides',
      operation: 'install-from-remote',
      async run() {
        events.push('first:start');
        await firstBlocker;
        events.push('first:end');
        return 'first';
      },
    });

    const second = runPluginLifecycleOperationSerially({
      pluginId: 'slides',
      operation: 'uninstall',
      run() {
        events.push('second:start');
        return 'second';
      },
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('不同插件的生命周期写操作可以并发执行', async () => {
    const events: string[] = [];
    let releaseSlides: () => void = () => {};
    const slidesBlocker = new Promise<void>((resolve) => {
      releaseSlides = resolve;
    });

    const slides = runPluginLifecycleOperationSerially({
      pluginId: 'slides',
      operation: 'install-from-remote',
      async run() {
        events.push('slides:start');
        await slidesBlocker;
        events.push('slides:end');
      },
    });

    const mindmap = runPluginLifecycleOperationSerially({
      pluginId: 'mindmap',
      operation: 'uninstall',
      run() {
        events.push('mindmap:start');
      },
    });

    await mindmap;
    expect(events).toEqual(['slides:start', 'mindmap:start']);

    releaseSlides();
    await slides;
    expect(events).toEqual(['slides:start', 'mindmap:start', 'slides:end']);
  });

  it('前一个操作失败后，后续操作仍会继续执行', async () => {
    const events: string[] = [];
    const first = runPluginLifecycleOperationSerially({
      pluginId: 'slides',
      operation: 'install-from-remote',
      run() {
        events.push('first');
        throw new Error('boom');
      },
    });

    const second = runPluginLifecycleOperationSerially({
      pluginId: 'slides',
      operation: 'set-enabled',
      run() {
        events.push('second');
        return 'ok';
      },
    });

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
    expect(events).toEqual(['first', 'second']);
  });
});

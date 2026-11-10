import { expect, it, vi } from 'vitest';
import { watchTsupConfigurations } from './watchTsupConfigurations.mjs';
it('多入口分别保留entry与成功钩子，首次全部声明结束才放行，后续重编仍通知', async () => {
  const first = Promise.withResolvers(), second = Promise.withResolvers(), options = [], ownSuccess = vi.fn(), afterBuild = vi.fn(), ready = vi.fn();
  const build = vi.fn(configuration => { options.push(configuration); return options.length === 1 ? first.promise : second.promise; });
  const watching = watchTsupConfigurations({ configuration: [{ entry: { index: 'index.ts' }, onSuccess: ownSuccess }, { entry: { worker: 'worker.ts' } }], build, afterBuild, ready });
  expect(options.map(option => option.entry)).toEqual([{ index: 'index.ts' }, { worker: 'worker.ts' }]);
  await options[0].onSuccess(); first.resolve(); await Promise.resolve(); expect(ready).not.toHaveBeenCalled();
  await options[1].onSuccess(); second.resolve(); await watching; expect(ownSuccess).toHaveBeenCalledTimes(1); expect(ready).toHaveBeenCalledTimes(1); expect(afterBuild).toHaveBeenCalledTimes(1);
  await options[1].onSuccess(); expect(ready).toHaveBeenCalledTimes(2); expect(afterBuild).toHaveBeenCalledTimes(2);
});
it('任一首轮失败不放行，也不运行完整产物的后续脚本', async () => {
  const ready = vi.fn(), afterBuild = vi.fn();
  await expect(watchTsupConfigurations({ configuration: [{ entry: ['index.ts'] }, { entry: ['worker.ts'] }], build: async option => { if (option.entry[0] === 'worker.ts') throw new Error('compile failed'); }, ready, afterBuild })).rejects.toThrow('compile failed');
  expect(ready).not.toHaveBeenCalled(); expect(afterBuild).not.toHaveBeenCalled();
});

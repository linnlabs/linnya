import { fork, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';

const tsxLoader = createRequire(import.meta.url).resolve('tsx');

/** 仅拥有本次开发会话创建的进程；退出/构建失败时一起收口，不查找或终止其他 App。 */
export function createDevelopmentProcessScope({ env = process.env } = {}) {
  const processes = new Set();
  const failure = Promise.withResolvers();
  let stopping = false;

  function start(task) {
    if (stopping) throw new Error('开发构建会话已停止');
    const startedAt = Date.now();
    const ready = Promise.withResolvers();
    const done = Promise.withResolvers();
    const options = { cwd: task.cwd, env: { ...env, ...task.env }, detached: process.platform !== 'win32' };
    const child = task.watch
      ? fork(task.file, task.args, { ...options, execArgv: ['--import', tsxLoader], silent: true })
      : spawn(task.file, task.args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = { child, done: done.promise, watch: task.watch };
    processes.add(entry);
    let isReady = false;
    function completeInitialBuild() {
      if (isReady) return;
      isReady = true;
      console.info(`[dev:${task.id}] ready (${Date.now() - startedAt}ms)`);
      ready.resolve();
    }
    function fail(error) {
      ready.reject(error);
      if (!stopping) failure.resolve(error);
    }
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', line => console.info(`[${task.id}] ${line}`));
    }
    child.on('message', message => {
      if (message?.type === 'build-ready') completeInitialBuild();
      if (message?.type === 'build-error' && !isReady) fail(new Error(`${task.id} 首次构建失败`));
    });
    child.once('error', error => {
      processes.delete(entry);
      fail(error);
      done.reject(error);
    });
    child.once('exit', (code, signal) => {
      processes.delete(entry);
      if (stopping) {
        ready.reject(new Error(`${task.id} 已停止`));
        done.resolve();
      } else if (code === 0 && !task.watch) {
        completeInitialBuild();
        done.resolve();
      } else {
        const error = new Error(`${task.id} 提前退出: ${signal ?? code}`);
        fail(error);
        done.reject(error);
      }
    });
    // 长期 watcher 的完成失败交给会话 owner；ready 由依赖图调用者接收。
    void done.promise.catch(() => {});
    void ready.promise.catch(() => {});
    return { ready: ready.promise, done: done.promise };
  }

  async function stop() {
    stopping = true;
    const active = [...processes];
    for (const { child, watch } of active) {
      if (watch && child.connected) child.send({ type: 'stop' });
      else terminateTree(child, 'SIGTERM');
    }
    const forceStop = setTimeout(() => {
      for (const { child } of processes) terminateTree(child, 'SIGKILL');
    }, 5000);
    try { await Promise.allSettled(active.map(entry => entry.done)); }
    finally { clearTimeout(forceStop); }
  }

  return { start, stop, failure: failure.promise };
}

function terminateTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

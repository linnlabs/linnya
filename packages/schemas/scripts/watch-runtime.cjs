const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const packageRoot = path.resolve(__dirname, '..');
const foundationRoot = path.resolve(packageRoot, '../foundation');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
// 首次清理与旧 watcher 相同；后续刷新不清空正在被消费者读取的双格式产物。
fs.rmSync(path.join(packageRoot, 'dist'), { recursive: true, force: true });
let timer = null;

function build() {
  try {
    execFileSync(pnpm, ['run', 'build:runtime'], { cwd: packageRoot, stdio: 'inherit' });
    process.send?.({ type: 'build-ready' });
  } catch (error) {
    console.error('[schemas] runtime rebuild failed:', error.message);
    process.send?.({ type: 'build-error' });
  }
}

function schedule() {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; build(); }, 100);
}

// Foundation 实现变化未必改变 .d.ts。不能只等声明更新，否则内联的运行代码会陈旧。
const watchers = [packageRoot, foundationRoot].flatMap(root => [
  fs.watch(path.join(root, 'src'), { recursive: true }, (_event, filename) => {
    if (filename && /\.ts$/u.test(filename) && !/\.(?:test|spec)\.ts$/u.test(filename)) schedule();
  }),
  fs.watch(root, (_event, filename) => {
    if (filename && /^(?:tsconfig(?:\.[^.]+)?\.json|package\.json)$/u.test(filename)) schedule();
  }),
]);

function stop() {
  if (timer !== null) clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  process.exit(0);
}
process.on('message', message => { if (message?.type === 'stop') stop(); });
process.on('disconnect', stop);
build();

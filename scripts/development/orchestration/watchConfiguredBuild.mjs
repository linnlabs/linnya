import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const [builder, configPath, ...afterBuildScripts] = process.argv.slice(2);
process.on('message', message => { if (message?.type === 'stop') process.exit(0); });
process.on('disconnect', () => process.exit(0));

async function runAfterBuildScripts() {
  for (const script of afterBuildScripts) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script}: exit=${code}`)));
    });
  }
}

try {
  if (builder === 'tsup') {
    const { build } = await import('tsup');
    const { default: configuration } = await import(pathToFileURL(path.resolve(configPath)).href);
    let initialBuildCompleted = false;
    await build({
      ...configuration,
      config: false,
      // tsup 按真实 buildDependencies 决定是否重编译；额外目录只排除运行数据/产物。
      watch: true,
      ignoreWatch: ['**/_dev_data/**', '**/target/**', 'dist/**', 'packages/plugins/*/dist/**'],
      async onSuccess() {
        await configuration.onSuccess?.();
        await runAfterBuildScripts();
        if (initialBuildCompleted) process.send?.({ type: 'build-ready' });
      },
    });
    // build() 包含首轮声明生成；不能在 JS onSuccess 时抢先启动依赖消费者。
    initialBuildCompleted = true;
    process.send?.({ type: 'build-ready' });
  } else if (builder === 'vite') {
    const { build } = await import('vite');
    const watcher = await build({ configFile: configPath, build: { watch: {}, reportCompressedSize: false } });
    watcher.on('event', async event => {
      if (event.code === 'ERROR') process.send?.({ type: 'build-error' });
      if (event.code === 'END') {
        await runAfterBuildScripts();
        process.send?.({ type: 'build-ready' });
      }
    });
  } else {
    throw new Error(`未知开发构建器: ${builder}`);
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}

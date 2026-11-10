import { startRendererDevelopmentServer } from '../../../orchestration/startRendererDevelopmentServer.mjs';

// Vite 自己处理 SIGTERM 并退出进程，因此它不能与 Desktop 看管器共用进程。
const starting = startRendererDevelopmentServer({
  root: process.argv[2], port: Number(process.argv[4]), cacheDir: process.argv[3],
});
process.on('disconnect', async () => {
  try {
    const { viteServer } = await starting;
    await viteServer.close();
  } finally {
    process.exit();
  }
});
const { url } = await starting;
if (process.connected) process.send({ url });

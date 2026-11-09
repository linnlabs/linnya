import { createServer } from 'vite';

export async function startRendererDevelopmentServer({ root, port = 5173, cacheDir, log = console.info } = {}) {
  // 直接绑定后读取实际端口，避免探测端口与真正监听之间被其他开发实例占用。
  const viteServer = await createServer({
    root,
    cacheDir,
    server: { host: '127.0.0.1', port },
  });
  try {
    await viteServer.listen();
    const address = viteServer.httpServer?.address();
    if (!address || typeof address === 'string') {
      throw new Error('Vite 已启动，但无法读取监听端口');
    }
    const url = `http://127.0.0.1:${address.port}`;
    log(`[renderer] dev server: ${url}`);
    return { viteServer, url };
  } catch (error) {
    await viteServer.close();
    throw error;
  }
}

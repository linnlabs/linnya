import type { AppServerBackendConfiguration } from '../../../app-hosts/linnya/app-server-bootstrap';

/** 路径/profile 与端口均由最外层 Desktop 决定，Backend 只消费冻结事实。 */
export function resolveDesktopBackendConfiguration(input: {
  readonly packaged: boolean;
  readonly developmentMode: boolean;
  readonly configuredApiPort?: string;
  readonly rendererUrl?: string;
}): AppServerBackendConfiguration {
  const development = !input.packaged && input.developmentMode;
  const port = input.configuredApiPort === undefined
    ? (development ? 0 : 3000)
    : Number(input.configuredApiPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('LINNYA_API_PORT 必须是 0-65535 的整数（0 表示自动分配）');
  }
  // start:electron 仍支持开发者单独运行默认 Vite；dev:electron 总会提供实际 URL。
  const rendererOrigin = !input.packaged && (development || input.rendererUrl !== undefined)
    ? new URL(input.rendererUrl ?? 'http://localhost:5173').origin
    : undefined;
  return {
    qdrant: { host: '127.0.0.1', port: development ? 0 : 6333 },
    server: { port, ...(rendererOrigin === undefined ? {} : { rendererOrigin }) },
  };
}

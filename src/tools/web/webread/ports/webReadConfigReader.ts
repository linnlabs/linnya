import {
  DEFAULT_WEB_READ_CONFIG,
  DEFAULT_WEB_READ_SETTINGS,
  type WebReadConfig,
  type WebReadSettings,
} from '../definitions/webReadConfig';

export interface WebReadConfigReader {
  read(): WebReadConfig;
  readSettings(): WebReadSettings;
}

const productDefaultReader: WebReadConfigReader = {
  read: () => DEFAULT_WEB_READ_CONFIG,
  readSettings: () => DEFAULT_WEB_READ_SETTINGS,
};

let activeReader: WebReadConfigReader = productDefaultReader;

export function getWebReadConfig(): WebReadConfig {
  return activeReader.read();
}

/** Electron main 安装持久化读取端口；返回值用于生命周期卸载和测试隔离。 */
export function installWebReadConfigReader(reader: WebReadConfigReader): () => void {
  activeReader = reader;
  return () => {
    if (activeReader === reader) activeReader = productDefaultReader;
  };
}

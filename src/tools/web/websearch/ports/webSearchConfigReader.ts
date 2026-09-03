import {
  DEFAULT_WEB_SEARCH_CONFIG,
  DEFAULT_WEB_SEARCH_SETTINGS,
  type WebSearchConfig,
  type WebSearchSettings,
} from '../definitions/webSearchConfig';

export interface WebSearchConfigReader {
  read(): WebSearchConfig;
  readSettings(): WebSearchSettings;
}

const productDefaultReader: WebSearchConfigReader = {
  read: () => DEFAULT_WEB_SEARCH_CONFIG,
  readSettings: () => DEFAULT_WEB_SEARCH_SETTINGS,
};

let activeReader: WebSearchConfigReader = productDefaultReader;

export function getWebSearchConfig(): WebSearchConfig {
  return activeReader.read();
}

/** App adapter 在启动时安装持久化读取端口；返回值用于测试或生命周期卸载。 */
export function installWebSearchConfigReader(reader: WebSearchConfigReader): () => void {
  activeReader = reader;
  return () => {
    if (activeReader === reader) activeReader = productDefaultReader;
  };
}

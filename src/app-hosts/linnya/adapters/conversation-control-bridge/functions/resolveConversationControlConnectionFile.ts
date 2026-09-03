import os from 'node:os';
import path from 'node:path';
import {
  CONVERSATION_CONTROL_CONNECTION_FILE_ENV,
  CONVERSATION_CONTROL_CONNECTION_FILE_NAME,
} from '@app/schemas';

/**
 * App 与独立 Node CLI 都能推导的用户级运行时位置。
 * 环境变量只用于测试或多实例隔离，正式连接不依赖 Electron userData 路径。
 */
export function resolveConversationControlConnectionFile(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory = os.homedir(),
): string {
  const override = environment[CONVERSATION_CONTROL_CONNECTION_FILE_ENV]?.trim();
  if (override) return path.resolve(override);

  return path.join(
    homeDirectory,
    '.linnya',
    'runtime',
    CONVERSATION_CONTROL_CONNECTION_FILE_NAME,
  );
}

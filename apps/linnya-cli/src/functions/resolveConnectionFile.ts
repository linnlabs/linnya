import os from 'node:os';
import path from 'node:path';
import {
  CONVERSATION_CONTROL_CONNECTION_FILE_ENV,
  CONVERSATION_CONTROL_CONNECTION_FILE_NAME,
} from '@app/schemas';

export function resolveConnectionFile(
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

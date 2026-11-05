import os from 'node:os';
import { resolveDevelopmentInstancePaths } from '../../../../src/shared/runtime-paths';
import type { SourceCheckoutIdentity } from '../../../../src/shared/runtime-paths/definitions/sourceCheckoutIdentity';
import { resolveCliSourceCheckout } from './resolveCliSourceCheckout';
import path from 'node:path';
import {
  CONVERSATION_CONTROL_CONNECTION_FILE_ENV,
  CONVERSATION_CONTROL_CONNECTION_FILE_NAME,
} from '@app/schemas';

export function resolveConnectionFile(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory = os.homedir(),
  sourceCheckout: SourceCheckoutIdentity | null = resolveCliSourceCheckout(),
): string {
  const override = environment[CONVERSATION_CONTROL_CONNECTION_FILE_ENV]?.trim();
  if (override) return path.resolve(override);
  if (sourceCheckout) {
    const { profileRoot } = resolveDevelopmentInstancePaths(sourceCheckout.root, environment.LINNYA_DEV_INSTANCE_ROOT);
    return path.join(profileRoot, 'runtime', CONVERSATION_CONTROL_CONNECTION_FILE_NAME);
  }
  return path.join(
    homeDirectory,
    '.linnya',
    'runtime',
    CONVERSATION_CONTROL_CONNECTION_FILE_NAME,
  );
}

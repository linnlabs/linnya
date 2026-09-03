import { z } from 'zod';

import type { AppServerActivitySnapshot } from '../definitions/appServerActivityRpc';

const AppServerActivitySnapshotSchema = z.object({
  has_executing_commands: z.boolean(),
}).strict();

export function parseAppServerActivityReadRequest(value: unknown): null {
  return z.null().parse(value);
}

export function parseAppServerActivitySnapshot(value: unknown): AppServerActivitySnapshot {
  const parsed = AppServerActivitySnapshotSchema.parse(value);
  return Object.freeze({ hasExecutingCommands: parsed.has_executing_commands });
}

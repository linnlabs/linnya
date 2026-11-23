import { Router } from 'express';
import { z } from 'zod';
import { parseScheduledClockOffset } from 'src/app-hosts/linnya/application/scheduled-tasks/functions/scheduledClockOverride';

const overridesSchema = z.object({
  clock: z.string().max(100).nullable().optional(),
  timezone: z.string().min(1).max(100).nullable().optional(),
}).strict();

export function createScheduledTaskClockDebugRouter(input: {
  readonly configure: (overrides: { clockOffsetMs?: number | null; timezone?: string | null }) => void;
  readonly recheck: (before: () => void) => Promise<void>;
}) {
  const router = Router();
  router.post('/clock', async (request, response, next) => {
    const parsed = overridesSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: 'invalid_overrides' }); return; }
    const { clock, timezone } = parsed.data;
    const clockOffsetMs = typeof clock === 'string' ? parseScheduledClockOffset(clock, Date.now()) : clock;
    if (typeof clock === 'string' && clockOffsetMs === null) { response.status(400).json({ error: 'invalid_clock' }); return; }
    try {
      if (timezone) new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch (error) {
      if (!(error instanceof RangeError)) { next(error); return; }
      response.status(400).json({ error: 'invalid_timezone' });
      return;
    }
    try {
      await input.recheck(() => input.configure({ clockOffsetMs, timezone }));
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}

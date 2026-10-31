import { z } from 'zod';

export const COMMAND_ISOLATION_SETUP_RPC_METHOD = 'desktop.command_isolation.ensure_ready';
export const CommandIsolationSetupRequestSchema = z.null();
export const CommandIsolationSetupResponseSchema = z.enum(['ready', 'cancelled']);

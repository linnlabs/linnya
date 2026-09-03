import { z } from 'zod';

export const ElectronProcessRoleSchema = z.enum([
  'main',
  'app-renderer',
  'hidden-worker',
  'gpu',
  'utility',
  'other',
]);
export type ElectronProcessRole = z.infer<typeof ElectronProcessRoleSchema>;

export const ElectronProcessMemoryMetricSchema = z.object({
  pid: z.number().int().positive(),
  type: z.string().min(1),
  role: ElectronProcessRoleSchema,
  ownerId: z.string().min(1).nullable(),
  name: z.string().optional(),
  serviceName: z.string().optional(),
  workingSetMB: z.number().nonnegative(),
  peakWorkingSetMB: z.number().nonnegative(),
  privateMB: z.number().nonnegative().nullable(),
  cpuPercent: z.number().nonnegative(),
  creationTime: z.number().nonnegative(),
  sandboxed: z.boolean().optional(),
});
export type ElectronProcessMemoryMetric = z.infer<typeof ElectronProcessMemoryMetricSchema>;

export const MainProcessMemorySchema = z.object({
  rssMB: z.number().nonnegative(),
  heapUsedMB: z.number().nonnegative(),
  externalMB: z.number().nonnegative(),
  arrayBuffersMB: z.number().nonnegative(),
});
export type MainProcessMemory = z.infer<typeof MainProcessMemorySchema>;

export const SystemMemorySchema = z.object({
  totalMB: z.number().nonnegative(),
  freeMB: z.number().nonnegative(),
});
export type SystemMemory = z.infer<typeof SystemMemorySchema>;

export const ElectronProcessMemorySnapshotSchema = z.object({
  success: z.literal(true),
  timestamp: z.number().int().nonnegative(),
  totalWorkingSetMB: z.number().nonnegative(),
  totalPrivateMB: z.number().nonnegative().nullable(),
  mainProcess: MainProcessMemorySchema,
  system: SystemMemorySchema,
  metrics: z.array(ElectronProcessMemoryMetricSchema),
});
export type ElectronProcessMemorySnapshot = z.infer<typeof ElectronProcessMemorySnapshotSchema>;

export const ElectronProcessMemoryErrorSchema = z.object({
  success: z.literal(false),
  error: z.string().min(1),
});
export type ElectronProcessMemoryError = z.infer<typeof ElectronProcessMemoryErrorSchema>;

export const ElectronProcessMemoryResponseSchema = z.discriminatedUnion('success', [
  ElectronProcessMemorySnapshotSchema,
  ElectronProcessMemoryErrorSchema,
]);
export type ElectronProcessMemoryResponse = z.infer<typeof ElectronProcessMemoryResponseSchema>;

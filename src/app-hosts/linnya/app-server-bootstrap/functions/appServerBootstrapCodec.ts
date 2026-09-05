import path from 'node:path';

import { z } from 'zod';

import { createBackendBootstrapFacts } from '../../backend-runtime';
import { createHostProcessEnvironment } from '../../../../infra/adapters/command-runtime/environment';
import { parseLocalProcessPlatformRuntime } from '../../../../infra/adapters/local-process-runtime/platform-runtime';
import {
  APP_SERVER_BOOTSTRAP_MAX_FRAME_BYTES,
  APP_SERVER_BOOTSTRAP_SCHEMA_VERSION,
  type AppServerBootstrap,
} from '../definitions/appServerBootstrap';

const NonEmptyStringSchema = z.string().min(1);
const AbsolutePathSchema = NonEmptyStringSchema.refine(value => path.isAbsolute(value), {
  message: '必须是绝对路径',
});
const PortSchema = z.number().int().min(1).max(65_535);
const PlatformSchema = z.enum([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'openbsd',
  'sunos',
  'win32',
  'cygwin',
  'netbsd',
]);
const ArchitectureSchema = z.enum([
  'arm',
  'arm64',
  'ia32',
  'loong64',
  'mips',
  'mipsel',
  'ppc64',
  'riscv64',
  's390x',
  'x64',
]);
const DistributionIdentitySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('source'),
    packaged: z.literal(false),
  }).strict(),
  z.object({
    kind: z.literal('community'),
    packaged: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal('official'),
    packaged: z.literal(true),
    releaseChannel: z.enum(['stable', 'beta']),
    releaseKeyId: NonEmptyStringSchema,
  }).strict(),
]);

const AppServerBootstrapSchema = z.object({
  schema_version: z.literal(APP_SERVER_BOOTSTRAP_SCHEMA_VERSION),
  backend_configuration: z.object({
    qdrant: z.object({
      host: NonEmptyStringSchema,
      port: PortSchema,
    }).strict(),
    server: z.object({
      port: PortSchema,
    }).strict(),
  }).strict(),
  backend_facts: z.object({
    applicationVersion: NonEmptyStringSchema,
    applicationExecutablePath: AbsolutePathSchema,
    platform: PlatformSchema,
    architecture: ArchitectureSchema,
    packaged: z.boolean(),
    distributionIdentity: DistributionIdentitySchema,
    resourcesPath: AbsolutePathSchema,
    mainBundleDirectory: AbsolutePathSchema,
    runtimePathRoots: z.object({
      developmentRoot: AbsolutePathSchema,
      appDataRoot: AbsolutePathSchema,
      workspaceRoot: AbsolutePathSchema,
      workspaceRootIsCustom: z.boolean(),
    }).strict(),
    exposeProviderOutboundDebugRoutes: z.boolean(),
  }).strict(),
  command_host_environment: z.object({
    kind: z.literal('host_process_environment'),
    entries: z.record(z.string(), z.string()),
  }).strict(),
  headless_node_executable_path: AbsolutePathSchema,
  local_process_platform_runtime: z.unknown(),
  text_measurement: z.object({
    use_browser_pretext: z.boolean(),
    use_harfbuzz: z.boolean(),
    worker_availability: z.discriminatedUnion('available', [
      z.object({ available: z.literal(true) }).strict(),
      z.object({
        available: z.literal(false),
        reason: NonEmptyStringSchema,
      }).strict(),
    ]),
  }).strict(),
}).strict();

export function parseAppServerBootstrap(value: unknown): AppServerBootstrap {
  const parsed = AppServerBootstrapSchema.parse(value);
  const localProcessPlatformRuntime = parseLocalProcessPlatformRuntime(
    parsed.local_process_platform_runtime,
  );
  if (localProcessPlatformRuntime.platform !== parsed.backend_facts.platform) {
    throw new Error('App Server local process runtime 与 Backend platform 不匹配');
  }
  return Object.freeze({
    schema_version: APP_SERVER_BOOTSTRAP_SCHEMA_VERSION,
    backend_configuration: Object.freeze({
      qdrant: Object.freeze(parsed.backend_configuration.qdrant),
      server: Object.freeze(parsed.backend_configuration.server),
    }),
    backend_facts: createBackendBootstrapFacts(parsed.backend_facts),
    command_host_environment: createHostProcessEnvironment(
      parsed.command_host_environment.entries,
    ),
    headless_node_executable_path: parsed.headless_node_executable_path,
    local_process_platform_runtime: localProcessPlatformRuntime,
    text_measurement: Object.freeze(parsed.text_measurement),
  });
}

export function encodeAppServerBootstrap(bootstrap: AppServerBootstrap): Buffer {
  const parsed = parseAppServerBootstrap(bootstrap);
  const bytes = Buffer.from(`${JSON.stringify(parsed)}\n`, 'utf8');
  if (bytes.byteLength > APP_SERVER_BOOTSTRAP_MAX_FRAME_BYTES) {
    throw new Error(
      `App Server bootstrap frame 超过 ${APP_SERVER_BOOTSTRAP_MAX_FRAME_BYTES} bytes`,
    );
  }
  return bytes;
}

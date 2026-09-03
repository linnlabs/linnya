import path from 'node:path';

import headlessNodeRuntimeCatalogSource from '../../../../config/headless-node-runtime.json';
import {
  APP_SERVER_BOOTSTRAP_SCHEMA_VERSION,
  encodeAppServerBootstrap,
  type AppServerBackendConfiguration,
} from '../../../app-hosts/linnya/app-server-bootstrap';
import type { BackendBootstrapFacts } from '../../../app-hosts/linnya/backend-runtime';
import type {
  DesktopTextMeasurementWorkerPort,
} from '../../../app-hosts/linnya/desktop-capabilities';
import type { HostProcessEnvironment } from '../../../infra/adapters/command-runtime/environment';
import type { AppServerProcessLaunch } from '../../../infra/adapters/app-server-process';
import {
  parseHeadlessNodeRuntimeCatalog,
  resolveHeadlessNodeRuntime,
} from '../../../infra/adapters/headless-node-runtime';
import { resolveElectronLocalProcessPlatformRuntime } from '../../local-process-runtime/production-runtime';
import { createAppServerProcessEnvironment } from '../functions/createAppServerProcessEnvironment';

export async function resolveElectronAppServerProcessLaunch(input: {
  readonly backendConfiguration: AppServerBackendConfiguration;
  readonly backendFacts: BackendBootstrapFacts;
  readonly commandHostEnvironment: HostProcessEnvironment;
  readonly textMeasurement: {
    readonly useBrowserPretext: boolean;
    readonly useHarfBuzz: boolean;
    readonly availability: DesktopTextMeasurementWorkerPort['availability'];
  };
  readonly processEnvironment: NodeJS.ProcessEnv;
}): Promise<AppServerProcessLaunch> {
  const runtimeDirectory = path.join(
    input.backendFacts.packaged
      ? input.backendFacts.resourcesPath
      : path.join(input.backendFacts.runtimePathRoots.developmentRoot, 'extraResources'),
    'headless-node-runtime',
    input.backendFacts.platform,
    input.backendFacts.architecture,
  );
  const headlessNode = await resolveHeadlessNodeRuntime({
    catalog: parseHeadlessNodeRuntimeCatalog(headlessNodeRuntimeCatalogSource),
    runtimeDirectory,
    platform: input.backendFacts.platform,
    architecture: input.backendFacts.architecture,
    verifyPreparedExecutableHash: !input.backendFacts.packaged,
  });
  const localProcessPlatformRuntime = resolveElectronLocalProcessPlatformRuntime({
    platform: input.backendFacts.platform,
    architecture: input.backendFacts.architecture,
    applicationVersion: input.backendFacts.applicationVersion,
    applicationExecutablePath: input.backendFacts.applicationExecutablePath,
    resourcesPath: input.backendFacts.resourcesPath,
    packaged: input.backendFacts.packaged,
    hostEnvironment: input.commandHostEnvironment.entries,
  });
  const entryPath = path.join(
    input.backendFacts.mainBundleDirectory,
    'app-server-entry.cjs',
  );

  return Object.freeze({
    executablePath: headlessNode.executablePath,
    entryPath,
    workingDirectory: input.backendFacts.packaged
      ? input.backendFacts.runtimePathRoots.appDataRoot
      : input.backendFacts.runtimePathRoots.developmentRoot,
    environment: createAppServerProcessEnvironment(input.processEnvironment),
    bootstrapBytes: encodeAppServerBootstrap({
      schema_version: APP_SERVER_BOOTSTRAP_SCHEMA_VERSION,
      backend_configuration: input.backendConfiguration,
      backend_facts: input.backendFacts,
      command_host_environment: input.commandHostEnvironment,
      headless_node_executable_path: headlessNode.executablePath,
      local_process_platform_runtime: localProcessPlatformRuntime,
      text_measurement: {
        use_browser_pretext: input.textMeasurement.useBrowserPretext,
        use_harfbuzz: input.textMeasurement.useHarfBuzz,
        worker_availability: input.textMeasurement.availability,
      },
    }),
  });
}

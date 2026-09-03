import {
  BackendRuntimeOwner,
  getBackendRuntimeOwner,
  getExistingBackendRuntimeOwner,
} from './backendRuntimeOwner';
import { Logger } from '../../../../shared/logger';
import type { AppServerBackendConfiguration } from '../../app-server-bootstrap';
import { installWebPageRenderer } from '../../../../tools/web/webread/ports/webPageRenderer';
import type { RouteDependencies } from '../../../../electron-main/routes';
import { ConversationRuntimeInitializationError } from '../../application/conversation-runtime';
import {
  createBackendHiddenWorkerRuntime,
  installBackendHiddenWorkerRuntimePort,
  installBackendRendererIntegrationPort,
  installBackendTextMeasurementRuntimeDependencies,
  installDesktopCredentialProtectionPort,
  installDesktopRasterPdfDocumentPort,
} from '../../desktop-capabilities';
import type { BackendHostDependencies } from '../definitions/backendHostDependencies';
import { installWorkspaceMutationPublisher } from '../../../../features/workspace/orchestration/workspaceMutationPublisherRegistry';
import { installRuntimePathRoots } from '../../../../shared/runtime-paths';
import { syncRegisteredBackendPluginRuntimeResources } from '../../plugin-registry/builtin';
import { installLegacyWorkspaceMigrationPaths } from '../../../../electron-main/migration/legacyWorkspaceMigrationPaths';

const logger = new Logger('App-Server-Backend');
let uninstallWebPageRenderer: (() => void) | null = null;

class BackendShutdownError extends Error {
  constructor(readonly failures: readonly unknown[]) {
    super('App Server Backend 存在多个未完成的收口步骤');
    this.name = 'BackendShutdownError';
  }
}

/** Backend 唯一启动编排；不注册 Electron IPC，也不选择物理宿主 adapter。 */
export async function initializeAppServerBackend(
  config: AppServerBackendConfiguration,
  hostDependencies: BackendHostDependencies,
): Promise<BackendRuntimeOwner> {
  installRuntimePathRoots(hostDependencies.bootstrap.runtimePathRoots);
  installLegacyWorkspaceMigrationPaths(hostDependencies.bootstrap.legacyUserDataDirectory);
  logger.info('App Server Backend 初始化开始');

  try {
    installDesktopCredentialProtectionPort(hostDependencies.credentialProtection);
    installBackendHiddenWorkerRuntimePort(
      createBackendHiddenWorkerRuntime(hostDependencies.hiddenWorkerHost),
    );
    installBackendTextMeasurementRuntimeDependencies(hostDependencies.textMeasurement);
    installBackendRendererIntegrationPort(hostDependencies.rendererIntegration);
    installDesktopRasterPdfDocumentPort(hostDependencies.rasterPdfDocument);
    uninstallWebPageRenderer?.();
    uninstallWebPageRenderer = installWebPageRenderer(hostDependencies.webPageRenderer);
    installWorkspaceMutationPublisher(
      hostDependencies.rendererIntegration.publishWorkspaceMutation,
    );
    logger.info('Initializing App Server Backend...');

    const runtimeOwner = getBackendRuntimeOwner(
      hostDependencies.processRuntime.qdrant,
      hostDependencies.processRuntime.launchOwnedPipeProcess,
      hostDependencies.processRuntime.queueWorkers,
      hostDependencies.bootstrap.runtimePathRoots,
      hostDependencies.bootstrap.applicationVersion,
    );
    const port = await runtimeOwner.start(config);
    logger.info(`BackendRuntimeOwner 已启动: port=${port}`);

    try {
      const apiServer = runtimeOwner.getApiServer();
      const services = runtimeOwner.getServices();
      if (!services.documentOcr) {
        throw new Error('路由配置失败：DocumentOcrPort 未初始化');
      }
      const routeDependencies: RouteDependencies = {
        knowledgeBaseService: services.knowledgeBaseService || undefined,
        transcriptionService: services.transcriptionService || undefined,
        documentOcr: services.documentOcr,
        backendBootstrap: hostDependencies.bootstrap,
        externalAuthorizationBrowser: hostDependencies.externalAuthorizationBrowser,
        rendererIntegration: hostDependencies.rendererIntegration,
        conversationExecutionRuntimeFactory:
          hostDependencies.conversationExecutionRuntimeFactory,
        commandOwnerLifecycleRegistration: {
          register: lifecycle => runtimeOwner.registerCommandOwnerLifecycle(lifecycle),
        },
        sandboxOwnerLifecycleRegistration: {
          register: lifecycle => runtimeOwner.registerSandboxOwnerLifecycle(lifecycle),
        },
      };
      const routeResult = await apiServer.configureRoutes(routeDependencies);
      runtimeOwner.setRouteConfigurationResult(routeResult);

      if (routeResult.conversationRoutesMounted) {
        logger.info('App Server Backend 路由配置完成');
      } else {
        logger.error(
          'App Server Backend 路由仅部分可用：conversation routes unavailable',
          { conversationInitError: routeResult.conversationInitError },
        );
      }
    } catch (routeError: unknown) {
      logger.error(
        'App Server Backend 路由配置失败',
        routeError,
      );
      const routeErrorMessage = routeError instanceof Error
        ? `${routeError.name}: ${routeError.message}`
        : 'unknown_route_configuration_error';
      runtimeOwner.setRouteConfigurationResult({
        conversationRoutesMounted: false,
        conversationControlBridgeMounted: false,
        conversationInitError: routeErrorMessage,
      });
      if (routeError instanceof ConversationRuntimeInitializationError) {
        runtimeOwner.markConversationRuntimeAppOwnerEnded();
      }
      await runtimeOwner.stop();
      throw routeError;
    }

    const routeConfigurationResult = runtimeOwner.getRouteConfigurationResult();
    if (routeConfigurationResult?.conversationRoutesMounted === false) {
      logger.warn(
        `App Server Backend 已启动但 conversation routes 不可用: port=${port}`,
      );
    } else {
      logger.info(
        `App Server Backend ready: port=${port}`,
      );
    }
    return runtimeOwner;
  } catch (error: unknown) {
    uninstallWebPageRenderer?.();
    uninstallWebPageRenderer = null;
    logger.error(
      'App Server Backend 初始化失败',
      error,
    );
    throw error;
  }
}

export async function shutdownAppServerBackend(): Promise<void> {
  const failures: unknown[] = [];
  try {
    logger.info('App Server Backend 开始关停');
    await getExistingBackendRuntimeOwner()?.stop();
  } catch (error: unknown) {
    failures.push(error);
  }

  uninstallWebPageRenderer?.();
  uninstallWebPageRenderer = null;

  try {
    await syncRegisteredBackendPluginRuntimeResources(new Set());
  } catch (error: unknown) {
    failures.push(error);
  }

  if (failures.length > 0) {
    const failure = failures.length === 1
      ? failures[0]
      : new BackendShutdownError(failures);
    logger.error('Failed to shut down App Server Backend:', failure);
    throw failure;
  }
  logger.info('App Server Backend 已关停');
}

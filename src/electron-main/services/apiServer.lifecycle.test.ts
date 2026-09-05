import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_CONTROL_BRIDGE_PATH,
  CONVERSATION_CONTROL_TOKEN_HEADER,
  ConversationControlConnectionDescriptorSchema,
} from '@app/schemas';

vi.mock('../routes', () => ({
  configureRoutes: vi.fn(),
  getRouteSummary: vi.fn(),
}));

import { configureRoutes, type RouteDependencies } from '../routes';
import { ApiServer } from './apiServer';

const startedServers: ApiServer[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.allSettled(startedServers.splice(0).map(server => server.stop()));
  await Promise.all(
    temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })),
  );
  vi.mocked(configureRoutes).mockReset();
});

function createRouteDependencies(): RouteDependencies {
  return {
    documentOcr: {
      resolveModelProfile: async () => undefined,
      recognizeDocument: async () => ({ pages: [] }),
    },
    backendBootstrap: {
      applicationVersion: '0.0.38',
      applicationExecutablePath: '/Applications/Linnya.app/Contents/MacOS/Linnya',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: false,
      distributionIdentity: { kind: 'source', packaged: false },
      resourcesPath: '/workspace/extraResources',
      mainBundleDirectory: '/workspace/dist/main',
      runtimePathRoots: {
        developmentRoot: '/workspace/linnya',
        appDataRoot: '/workspace/linnya/_dev_data',
        workspaceRoot: '/workspace/linnya/_dev_data',
        workspaceRootIsCustom: false,
      },
      exposeProviderOutboundDebugRoutes: true,
    },
    externalAuthorizationBrowser: { open: async () => undefined },
    rendererIntegration: {
      connectModelCatalogUpdates: async () => () => undefined,
      publishIngestionStatus: () => undefined,
      queueJobPresentationPublisher: {
        publishProgress: () => undefined,
        publishCompletion: () => undefined,
        publishFailure: () => undefined,
      },
      publishKnowledgeGraphProgress: () => undefined,
      publishTranscriptionProgress: () => undefined,
      publishWorkspaceMutation: () => undefined,
      publishPluginRendererPush: () => undefined,
      publishTodosChanged: () => undefined,
      publishPluginsChanged: () => undefined,
    },
    conversationExecutionRuntimeFactory: {
      create: async () => {
        throw new Error('ApiServer lifecycle test does not initialize conversation runtime');
      },
    },
    commandOwnerLifecycleRegistration: { register: () => undefined },
    sandboxOwnerLifecycleRegistration: { register: () => undefined },
  };
}

describe('ApiServer lifecycle', () => {
  it('并发停止共享同一个收口任务，完成后重复停止保持幂等', async () => {
    const server = new ApiServer();
    startedServers.push(server);
    await server.start(0);

    const firstStop = server.stop();
    const secondStop = server.stop();

    expect(secondStop).toBe(firstStop);
    await expect(firstStop).resolves.toBeUndefined();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('CLI 与 Renderer token 互不越权，并随 Host 生命周期发布和撤销连接描述', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-api-server-'));
    temporaryRoots.push(temporaryRoot);
    const connectionFile = path.join(temporaryRoot, 'runtime', 'connection.json');
    const cliToken = 'c'.repeat(64);
    const server = new ApiServer({
      conversationControlConnectionFile: connectionFile,
      conversationControlSessionToken: cliToken,
      appInstanceId: 'app-instance-security-test',
      pid: 42,
    });
    startedServers.push(server);
    server.setupMiddleware();
    const port = await server.start(0);

    vi.mocked(configureRoutes).mockImplementation(async (app, _dependencies, hostContext) => {
      app.get('/renderer-probe', (_req, res) => res.json({ owner: 'renderer' }));
      app.post(`${CONVERSATION_CONTROL_BRIDGE_PATH}/handshake`, (_req, res) => res.json({
        owner: 'conversation-control',
        app_instance_id: hostContext.conversationControl.appInstanceId,
      }));
      return {
        conversationRoutesMounted: true,
        conversationControlBridgeMounted: true,
      };
    });
    await server.configureRoutes(createRouteDependencies());

    const descriptor = ConversationControlConnectionDescriptorSchema.parse(
      JSON.parse(await fs.readFile(connectionFile, 'utf8')),
    );
    expect(descriptor).toMatchObject({
      port,
      app_instance_id: 'app-instance-security-test',
      session_token: cliToken,
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const cliHandshake = await fetch(`${baseUrl}${CONVERSATION_CONTROL_BRIDGE_PATH}/handshake`, {
      method: 'POST',
      headers: { [CONVERSATION_CONTROL_TOKEN_HEADER]: cliToken },
    });
    expect(cliHandshake.status).toBe(200);
    expect(await cliHandshake.json()).toMatchObject({ owner: 'conversation-control' });

    const cliOnRenderer = await fetch(`${baseUrl}/renderer-probe`, {
      headers: { [CONVERSATION_CONTROL_TOKEN_HEADER]: cliToken },
    });
    expect(cliOnRenderer.status).toBe(401);

    const rendererOnCli = await fetch(
      `${baseUrl}${CONVERSATION_CONTROL_BRIDGE_PATH}/handshake`,
      { method: 'POST', headers: { 'x-api-token': server.getToken() } },
    );
    expect(rendererOnCli.status).toBe(401);

    const rendererProbe = await fetch(`${baseUrl}/renderer-probe`, {
      headers: { 'x-api-token': server.getToken() },
    });
    expect(rendererProbe.status).toBe(200);

    await server.stop();
    await expect(fs.stat(connectionFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

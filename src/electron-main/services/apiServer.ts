import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Server } from 'http';
import { randomBytes, randomUUID } from 'crypto';
import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  CONVERSATION_CONTROL_TOKEN_HEADER,
  ConversationControlErrorResponseSchema,
} from '@app/schemas';
import {
  createConversationControlDescriptorOwner,
  resolveConversationControlConnectionFile,
  type ConversationControlDescriptorOwner,
} from 'src/app-hosts/linnya/adapters/conversation-control-bridge';
import {
  configureRoutes,
  type RouteConfigurationResult,
  type RouteDependencies,
  getRouteSummary,
} from '../routes';
import {
  API_SERVER_BIND_HOST,
  isAllowedApiCorsOrigin,
  isConversationControlApiPath,
  resolveApiCorsOrigin,
} from './apiServerSecurityRules';

const DEFAULT_BODY_LIMIT = '10mb';

function isLargePayloadRoute(req: Request): boolean {
  if (req.method !== 'POST') {
    return false;
  }

  if (req.path === '/api/v1/conversation/next') {
    return true;
  }

  if (req.path === '/api/v1/conversation/attachments/images') {
    return true;
  }

  if (req.path === '/api/v1/transcription/transcribe') {
    return true;
  }

  if (isConversationControlApiPath(req.path)) {
    return true;
  }

  return /^\/api\/v1\/knowledge-base\/[^/]+\/documents$/.test(req.path);
}

export interface ApiServerOptions {
  readonly conversationControlConnectionFile?: string;
  readonly appInstanceId?: string;
  readonly conversationControlSessionToken?: string;
  readonly pid?: number;
  readonly now?: () => number;
}

export class ApiServerShutdownError extends Error {
  constructor(readonly failures: readonly unknown[]) {
    super(`API server shutdown failed in ${failures.length} stage(s)`);
    this.name = 'ApiServerShutdownError';
  }
}

export class ApiServer {
  private app: express.Application;
  private server: Server | null = null;
  private boundPort: number | null = null;
  private stoppingPromise: Promise<void> | null = null;
  private readonly rendererSessionToken: string;
  private readonly conversationControlSessionToken: string;
  private readonly appInstanceId: string;
  private readonly conversationControlDescriptor: ConversationControlDescriptorOwner;

  constructor(options: ApiServerOptions = {}) {
    this.app = express();
    this.rendererSessionToken = randomBytes(32).toString('hex');
    this.conversationControlSessionToken =
      options.conversationControlSessionToken ?? randomBytes(32).toString('hex');
    this.appInstanceId = options.appInstanceId ?? randomUUID();
    this.conversationControlDescriptor = createConversationControlDescriptorOwner({
      connectionFile:
        options.conversationControlConnectionFile ?? resolveConversationControlConnectionFile(),
      appInstanceId: this.appInstanceId,
      sessionToken: this.conversationControlSessionToken,
      pid: options.pid ?? process.pid,
      now: options.now,
    });
  }

  public setupMiddleware(): void {
    this.app.use(helmet({
      contentSecurityPolicy: false
    }));

    this.app.use(cors({
      origin: resolveApiCorsOrigin,
      credentials: true
    }));

    // CORS 只能控制浏览器是否暴露响应；这里在路由前直接拒绝非桌面端来源的网页请求。
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.get('origin');
      if (!isAllowedApiCorsOrigin(origin)) {
        res.status(403).json({ error: 'origin_not_allowed' });
        return;
      }
      next();
    });

    // SEC-06：Renderer 与 CLI 使用互不相通的 token；放在 body parser 前，避免未授权大请求先消耗解析资源。
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const isConversationControl = isConversationControlApiPath(req.path);
      const suppliedToken = isConversationControl
        ? req.headers[CONVERSATION_CONTROL_TOKEN_HEADER]
        : req.headers['x-api-token'];
      const requiredToken = isConversationControl
        ? this.conversationControlSessionToken
        : this.rendererSessionToken;
      if (suppliedToken !== requiredToken) {
        if (isConversationControl) {
          res.status(401).json(ConversationControlErrorResponseSchema.parse({
            schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
            ok: false,
            error: {
              code: 'unauthorized',
              message: 'Invalid conversation-control session token',
              retryable: false,
            },
          }));
          return;
        }
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      next();
    });

    const defaultJsonParser = express.json({ limit: DEFAULT_BODY_LIMIT });
    const defaultUrlencodedParser = express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT });

    // SEC-07：默认请求体收紧到 10mb；大 payload 路由必须在各自 router 中显式声明限额。
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (isLargePayloadRoute(req)) {
        next();
        return;
      }
      defaultJsonParser(req, res, next);
    });
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (isLargePayloadRoute(req)) {
        next();
        return;
      }
      defaultUrlencodedParser(req, res, next);
    });

    // 正常请求在启动预加载时很多，默认只记录异常或明显慢请求，避免淹没真正问题。
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const startMs = Date.now();
      res.on('finish', () => {
        const durationMs = Date.now() - startMs;
        if (res.statusCode >= 400 || durationMs >= 3000) {
          console.warn(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${durationMs}ms)`);
        }
      });
      next();
    });
  }

  public async configureRoutes(routeDependencies: RouteDependencies): Promise<RouteConfigurationResult> {
    console.log('[Backend Service] 🚦 开始配置应用路由...');
    
    const routeResult = await configureRoutes(this.app, routeDependencies, {
      conversationControl: { appInstanceId: this.appInstanceId },
    });

    if (routeResult.conversationControlBridgeMounted) {
      if (this.boundPort === null) {
        throw new Error('Conversation-control bridge cannot publish before API server start');
      }
      await this.conversationControlDescriptor.publish(this.boundPort);
    }
    
    const routeSummary = getRouteSummary(routeDependencies, routeResult);
    console.log('[Backend Service] 📋 路由配置摘要:', JSON.stringify(routeSummary, null, 2));

    if (routeResult.conversationRoutesMounted) {
      console.log('[Backend Service] ✅ 应用路由配置完成');
    } else {
      console.warn('[Backend Service] ⚠️ 应用路由配置部分完成：会话路由未挂载', {
        conversationInitError: routeResult.conversationInitError,
      });
    }

    return routeResult;
  }

  public getToken(): string {
    return this.rendererSessionToken;
  }

  public async start(port: number): Promise<number> {
    if (this.stoppingPromise) {
      throw new Error('API server is still stopping');
    }
    if (this.server) {
      throw new Error('API server already owns a server instance');
    }
    try {
      return await this.listen(port);
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) {
        throw error;
      }
      const fallbackPort = port + 1;
      console.error(`[Backend Service] Port ${port} is already in use. Trying ${fallbackPort}...`);
      return this.listen(fallbackPort);
    }
  }

  private listen(requestedPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(requestedPort, API_SERVER_BIND_HOST);
      this.server = server;
      const fail = (error: NodeJS.ErrnoException): void => {
        server.off('listening', ready);
        if (this.server === server) this.server = null;
        reject(error);
      };
      const ready = (): void => {
        server.off('error', fail);
        const address = server.address();
        if (!address || typeof address === 'string') {
          if (this.server === server) this.server = null;
          reject(new Error('API server did not expose its listening address'));
          return;
        }
        server.on('error', error => {
          console.error('[Backend Service] ❌ Express server error after start:', error);
        });
        this.boundPort = address.port;
        console.log(
          `[Backend Service] ✅ Express HTTP server is now listening on http://${API_SERVER_BIND_HOST}:${address.port}`,
        );
        resolve(address.port);
      };
      server.once('error', fail);
      server.once('listening', ready);
    });
  }

  public stop(): Promise<void> {
    if (this.stoppingPromise) {
      return this.stoppingPromise;
    }

    const stopSettlement = this.stopOnce(this.server);
    const trackedStopSettlement = stopSettlement.finally(() => {
      if (this.stoppingPromise === trackedStopSettlement) {
        this.stoppingPromise = null;
      }
    });
    this.stoppingPromise = trackedStopSettlement;
    return trackedStopSettlement;
  }

  private async stopOnce(server: Server | null): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.conversationControlDescriptor.revoke();
    } catch (error: unknown) {
      failures.push(error);
    }

    if (server) {
      try {
        await this.closeServer(server);
      } catch (error: unknown) {
        failures.push(error);
      }
    }

    if (failures.length > 0) throw new ApiServerShutdownError(failures);
  }

  private closeServer(server: Server): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const forceCloseTimeout = setTimeout(() => {
        console.log('[Backend Service] Force closing server due to timeout');
        server.closeAllConnections?.();
        if (this.server === server) {
          this.server = null;
        }
        this.boundPort = null;
        settled = true;
        console.log('[Backend Service] Server force stopped');
        resolve();
      }, 5000);

      server.close((error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(forceCloseTimeout);
        if (error) {
          console.error('[Backend Service] Error during server close:', error);
          reject(error);
          return;
        }
        if (this.server === server) {
          this.server = null;
        }
        this.boundPort = null;
        console.log('[Backend Service] Server stopped gracefully');
        resolve();
      });

      server.closeIdleConnections?.();
    });
  }
}

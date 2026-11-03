import { readSourceCheckoutIdentity } from 'src/shared/runtime-paths/functions/readSourceCheckoutIdentity';
import type { AuditLevel, LinnyaAuditRuntime } from 'src/domains/audit';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_CONTROL_BRIDGE_PATH,
  CONVERSATION_CONTROL_PROTOCOL_VERSION,
  ConversationControlHandshakeResponseSchema,
} from '@app/schemas';
import { createConversationControlBridgeRouter } from 'src/app-hosts/linnya/adapters/conversation-control-bridge/conversationControlBridge.router';
import { LINNYA_CONVERSATION_CONTROL_CAPABILITIES } from 'src/app-hosts/linnya/adapters/conversation-control-bridge/definitions/conversationControlBridge';
import { ConversationControlError } from 'src/app-hosts/linnya/application/conversation-control';
import { createAppServerProcessEnvironment } from 'src/app-hosts/linnya/app-server-runtime/functions/createAppServerProcessEnvironment';
import { CONVERSATION_SCHEMAS } from 'src/app-hosts/linnya/adapters/persistence/event-store/conversation.schema';
import { SQLiteEventStore } from 'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation';
import { RUN_DESCRIPTORS_SCHEMA } from 'src/app-hosts/linnya/adapters/persistence/run-descriptors/schema-providers';
import {
  bootstrapAgentRuntimeSingletons,
  resetAgentRuntimeSingletonsForTest,
} from '../services/agentRuntimeSingletons';
import { runCliProcess } from '../../../apps/linnya-cli/src/__integration-tests__/__test-helpers__/scriptedCliBridge';

/**
 * `linnya audit` 在 App 里是否可用，取决于一条完整链路：
 * Host 环境 → App Server 环境白名单 → Audit 等级解析 → 运行时审计控制端口 → 控制桥握手。
 * 这里用真实实现串起整条链路（只替换业务 use case），防止任何一环悄悄改变“握手声明了什么”。
 */

const DEVELOPMENT_APP = { NODE_ENV: 'development', LINNYA_DEV_MODE: 'true' } as const;
const BACKEND_AUDIT_ENVIRONMENT_KEYS = ['NODE_ENV', 'LINNYA_DEV_MODE', 'LINNYA_AUDIT_LEVEL'] as const;
const SESSION_TOKEN = 'a'.repeat(64);

interface AuditScenario {
  readonly name: string;
  /** Electron Main 或 CLI Runtime 交给 App Server 启动器的环境。 */
  readonly environment: Readonly<Record<string, string>>;
  readonly packaged: boolean;
  readonly level: AuditLevel;
  readonly available: boolean;
}

const SCENARIOS: readonly AuditScenario[] = [
  {
    name: '开发 App 默认不启用审计',
    environment: DEVELOPMENT_APP,
    packaged: false,
    level: 'off', available: true,
  },
  ...(['behavior', 'response', 'stream'] as const).map(level => ({
    name: `开发 App 设置 LINNYA_AUDIT_LEVEL=${level}`,
    environment: { ...DEVELOPMENT_APP, LINNYA_AUDIT_LEVEL: level },
    packaged: false,
    level, available: true,
  })),
  {
    name: '开发 App 的未知审计等级回到默认关闭',
    environment: { ...DEVELOPMENT_APP, LINNYA_AUDIT_LEVEL: 'verbose' },
    packaged: false,
    level: 'off', available: true,
  },
  {
    name: '没有开发身份时 LINNYA_AUDIT_LEVEL 不生效',
    environment: { LINNYA_AUDIT_LEVEL: 'behavior' },
    packaged: false,
    level: 'off', available: true,
  },
  {
    name: '发行包忽略开发环境与 LINNYA_AUDIT_LEVEL',
    environment: { ...DEVELOPMENT_APP, LINNYA_AUDIT_LEVEL: 'stream' },
    packaged: true,
    level: 'off', available: false,
  },
];

interface StartedHost {
  readonly baseUrl: string;
  readonly connectionFile: string;
  readonly audit: LinnyaAuditRuntime;
  readonly execute: ReturnType<typeof vi.fn>;
}

const servers: Server[] = [];
const databases: Database.Database[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  })));
  databases.splice(0).forEach(db => db.close());
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  resetAgentRuntimeSingletonsForTest();
  vi.unstubAllEnvs();
});

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  for (const schema of [...CONVERSATION_SCHEMAS, ...RUN_DESCRIPTORS_SCHEMA]) {
    db.exec(schema);
  }
  databases.push(db);
  return db;
}

async function startHost(scenario: AuditScenario): Promise<StartedHost> {
  // Backend 是独立 sidecar，只看到启动器白名单过滤后的环境。
  const backendEnvironment = createAppServerProcessEnvironment({
    PATH: '/usr/bin',
    ...scenario.environment,
  });
  for (const key of BACKEND_AUDIT_ENVIRONMENT_KEYS) vi.stubEnv(key, backendEnvironment[key]);
  const db = createDatabase();
  const { runtime } = await bootstrapAgentRuntimeSingletons({
    db,
    eventStore: new SQLiteEventStore(db),
    packaged: scenario.packaged,
  });
  // 审计等级只在装配时读取；之后环境变化（以及泄漏进 CLI 子进程的变量）都不应再参与。
  vi.unstubAllEnvs();

  // 业务 use case 不是这里的被测对象：命令一旦越过能力门禁，就以 run_not_found 表示“到达了 Host”。
  const execute = vi.fn(async () => {
    throw new ConversationControlError('run_not_found', 'Run does not belong to the conversation');
  });
  const app = express();
  app.use(
    CONVERSATION_CONTROL_BRIDGE_PATH,
    createConversationControlBridgeRouter({
      useCase: { execute },
      appInstanceId: 'audit-capability-test',
      appVersion: '0.0.38',
      auditControl: runtime.audit,
      sourceCheckout: scenario.packaged ? null : readSourceCheckoutIdentity(process.cwd()),
      diagnostics: { error: vi.fn() },
    }),
  );
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');

  const root = await mkdtemp(join(tmpdir(), 'linnya-audit-capability-'));
  temporaryRoots.push(root);
  const connectionFile = join(root, 'connection.json');
  await writeFile(connectionFile, JSON.stringify({
    protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
    app_instance_id: 'audit-capability-test',
    pid: process.pid,
    host: '127.0.0.1',
    port: address.port,
    session_token: SESSION_TOKEN,
    created_at: Date.now(),
    updated_at: Date.now(),
  }), { mode: 0o600 });
  return {
    baseUrl: `http://127.0.0.1:${address.port}${CONVERSATION_CONTROL_BRIDGE_PATH}`,
    connectionFile,
    audit: runtime.audit,
    execute,
  };
}

async function readHandshakeCapabilities(host: StartedHost): Promise<readonly string[]> {
  const response = await fetch(`${host.baseUrl}/handshake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
      client_name: 'linnya-cli',
      client_version: '0.1.0',
    }),
  });
  expect(response.status).toBe(200);
  return ConversationControlHandshakeResponseSchema.parse(await response.json()).capabilities;
}

describe('conversation-control 握手的 audit 能力', () => {
  it.each(SCENARIOS)('$name', async scenario => {
    const host = await startHost(scenario);

    expect(host.audit.level).toBe(scenario.level);
    expect(host.audit.available).toBe(scenario.available);
    // off 仍可读历史、切档；只有生产身份摘掉两项能力。
    expect(await readHandshakeCapabilities(host)).toEqual(
      LINNYA_CONVERSATION_CONTROL_CAPABILITIES.filter(
        capability => scenario.available || !['audit', 'audit_level'].includes(capability),
      ),
    );
  });

  it('真实 CLI：off 仍可读历史，切档后的 doctor 和错误携带当前实例信息', async () => {
    const host = await startHost(SCENARIOS[0]);
    const doctor = await runCliProcess(['doctor'], host.connectionFile);
    expect(doctor.exitCode, doctor.stderr).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      capabilities: expect.arrayContaining(['audit', 'audit_level']),
      unavailable_capabilities: [],
      app: { source_root: process.cwd(), audit_level: 'off' },
    });
    host.audit.setLevel('response');
    const changed = await runCliProcess(['doctor'], host.connectionFile);
    expect(JSON.parse(changed.stdout)).toMatchObject({ app: { audit_level: 'response' } });
    const reached = await runCliProcess(['audit', 'conversation-1', '--run', 'run-1'], host.connectionFile);
    expect(reached.exitCode).toBe(6);
    expect(JSON.parse(reached.stderr)).toMatchObject({
      error: { code: 'run_not_found' },
      connection: { state: 'connected', instance: { source_root: process.cwd(), audit_level: 'response' } },
    });
    expect(host.execute).toHaveBeenCalledOnce();
  }, 30_000);
});

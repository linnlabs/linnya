import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_CONTROL_BRIDGE_PATH,
  CONVERSATION_CONTROL_PROTOCOL_VERSION,
  CONVERSATION_CONTROL_TOKEN_HEADER,
  ConversationControlProjectsResponseSchema,
  type ProjectMutationEvent,
} from '@app/schemas';
import { createProjectLifecycle, PROJECT_SCHEMAS } from 'src/domains/projects';
import { controlProjects } from 'src/app-hosts/linnya/application/conversation-control/orchestration/controlProjects';
import { createConversationControlBridgeRouter } from 'src/app-hosts/linnya/adapters/conversation-control-bridge/conversationControlBridge.router';
import { runCliProcess } from '../../../../../../apps/linnya-cli/src/__integration-tests__/__test-helpers__/scriptedCliBridge';

describe('Project CLI process → real HTTP bridge → Project SQLite', () => {
  let root: string;
  let db: Database.Database;
  let server: Server;
  let connectionFile: string;
  let commandUrl: string;
  const token = 'e'.repeat(64);
  let events: ProjectMutationEvent[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'linnya-project-cli-'));
    db = new Database(join(root, 'projects.sqlite'));
    db.pragma('foreign_keys = ON');
    PROJECT_SCHEMAS.forEach(sql => db.exec(sql));
    events = [];
    const app = express();
    app.use((request, response, next) => {
      if (request.headers[CONVERSATION_CONTROL_TOKEN_HEADER] !== token) {
        response.sendStatus(401);
        return;
      }
      next();
    });
    app.use(
      CONVERSATION_CONTROL_BRIDGE_PATH,
      createConversationControlBridgeRouter({
        appInstanceId: 'project-cli-test',
        appVersion: '0.0.38',
        diagnostics: { error: vi.fn() },
        useCase: {
          async execute(request) {
            if (request.command !== 'projects') throw new Error('Expected project command');
            return controlProjects(
              createProjectLifecycle(db, { publish: event => events.push(event) }),
              request
            );
          },
        },
      })
    );
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    commandUrl = `http://127.0.0.1:${address.port}${CONVERSATION_CONTROL_BRIDGE_PATH}/commands`;
    connectionFile = join(root, 'connection.json');
    await writeFile(
      connectionFile,
      JSON.stringify({
        protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
        app_instance_id: 'project-cli-test',
        pid: process.pid,
        host: '127.0.0.1',
        port: address.port,
        session_token: token,
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
      { mode: 0o600 }
    );
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  async function execute(...args: string[]) {
    const result = await runCliProcess(['projects', ...args], connectionFile);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    return ConversationControlProjectsResponseSchema.parse(JSON.parse(result.stdout));
  }

  it('空库只读、创建、查询、修改、清空描述和重新打开数据库保留数据', async () => {
    expect(await execute()).toMatchObject({ action: 'list', projects: [] });
    expect(await execute('list')).toMatchObject({ action: 'list', projects: [] });
    expect(events).toEqual([]);
    const created = await execute('create', ' Research ', '--description', 'Notes');
    if (created.action !== 'create') throw new Error('Expected creation');
    const id = created.project.project_id;
    expect(created.project).toMatchObject({
      name: 'Research',
      description: 'Notes',
      system_role: null,
    });
    expect(await execute('get', id)).toMatchObject({ action: 'get', project: created.project });
    await execute('update', id, '--name', 'Renamed');
    expect(await execute('get', id)).toMatchObject({
      project: { name: 'Renamed', description: 'Notes' },
    });
    await execute('update', id, '--description=');
    expect(events.map(event => event.type)).toEqual([
      'project.created',
      'project.updated',
      'project.updated',
    ]);
    expect(events.every(event => event.projectId === id)).toBe(true);
    db.close();
    db = new Database(join(root, 'projects.sqlite'));
    expect(await execute('get', id)).toMatchObject({
      project: { project_id: id, name: 'Renamed', description: '' },
    });
    expect(await execute('list')).toMatchObject({
      projects: [{ project_id: id, name: 'Renamed' }],
    });
  }, 20_000);

  it('重名、不存在和非法更新有稳定退出码，失败不会写入或发布通知', async () => {
    const first = await execute('create', 'First');
    if (first.action !== 'create') throw new Error('Expected creation');
    const id = first.project.project_id;
    await execute('create', 'Taken');
    const initialEvents = [...events];
    for (const args of [
      ['create', ' First '],
      ['update', id, '--name', 'Taken'],
    ]) {
      const result = await runCliProcess(['projects', ...args], connectionFile);
      expect(result.exitCode).toBe(6);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'project_name_conflict' } });
    }
    for (const args of [
      ['get', 'missing'],
      ['update', 'missing', '--name', 'New'],
    ]) {
      const result = await runCliProcess(['projects', ...args], connectionFile);
      expect(result.exitCode).toBe(6);
      expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'project_not_found' } });
    }
    const invalid = await runCliProcess(['projects', 'update', id, '--name', ' '], connectionFile);
    expect(invalid.exitCode).toBe(2);
    for (const command of [
      { action: 'create', input: { name: 'Injected', system_role: 'default' } },
      { action: 'update', project_id: id, updates: {} },
      { action: 'delete', project_id: id },
    ]) {
      const result = await fetch(commandUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CONVERSATION_CONTROL_TOKEN_HEADER]: token },
        body: JSON.stringify({ schema_version: 1, command: 'projects', ...command }),
      });
      expect(result.status).toBe(400);
    }
    expect(events).toEqual(initialEvents);
    expect(createProjectLifecycle(db).get(id).name).toBe('First');
    expect(createProjectLifecycle(db).list()).toHaveLength(2);
  }, 20_000);

  it('删除要求明确确认，只删除空普通项目；关联内容和默认项目保持原样', async () => {
    const creation = await execute('create', 'Temporary');
    if (creation.action !== 'create') throw new Error('Expected creation');
    const id = creation.project.project_id;
    const unconfirmed = await runCliProcess(['projects', 'delete', id], connectionFile);
    expect(unconfirmed.exitCode).toBe(2);
    expect(createProjectLifecycle(db).get(id).name).toBe('Temporary');
    db.exec('CREATE TABLE plugin_records (project_id TEXT REFERENCES projects(id) ON DELETE CASCADE)');
    db.prepare('INSERT INTO plugin_records VALUES (?)').run(id);
    const blocked = await runCliProcess(['projects', 'delete', id, '--yes'], connectionFile);
    expect(blocked.exitCode).toBe(6);
    expect(JSON.parse(blocked.stderr)).toMatchObject({ error: { code: 'project_not_empty' } });
    expect(db.prepare('SELECT project_id FROM plugin_records').get()).toEqual({ project_id: id });
    db.prepare('DELETE FROM plugin_records WHERE project_id = ?').run(id);
    const defaultId = createProjectLifecycle(db).ensureDefault();
    const defaultDelete = await runCliProcess(['projects', 'delete', defaultId, '--yes'], connectionFile);
    expect(defaultDelete.exitCode).toBe(6);
    expect(JSON.parse(defaultDelete.stderr)).toMatchObject({ error: { code: 'project_delete_blocked' } });
    expect(await execute('delete', id, '--yes')).toMatchObject({ action: 'delete', project_id: id });
    const repeated = await runCliProcess(['projects', 'delete', id, '--yes'], connectionFile);
    expect(repeated.exitCode).toBe(6);
    expect(JSON.parse(repeated.stderr)).toMatchObject({ error: { code: 'project_not_found' } });
    expect(events.map(event => event.type)).toEqual(['project.created', 'project.deleted']);
  }, 20_000);
});

import { controlSkills } from '../../../app-hosts/linnya/application/conversation-control/orchestration/controlSkills';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { CONVERSATION_CONTROL_PROTOCOL_VERSION } from '@app/schemas';
import { createLocalSkillManagement } from '../adapters/createLocalSkillManagement';
import { createConversationControlBridgeRouter } from '../../../app-hosts/linnya/adapters/conversation-control-bridge/conversationControlBridge.router';

/** 真 CLI 子进程→鉴权/握手/严格合同→真实文件 owner，不用模拟 CLI 输出证明安装成功。 */
describe('Skill CLI lifecycle', () => {
  it('CLI 安装、原文编辑、整包升级、冲突退出码和卸载', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-skill-cli-'));
    const draft = path.join(root, 'draft'); fs.mkdirSync(draft);
    fs.writeFileSync(path.join(draft, 'SKILL.md'), '---\nname: cli-fixture\ndescription: CLI fixture\n---\nBefore\n');
    fs.writeFileSync(path.join(draft, 'old.txt'), 'old');
    const owner = createLocalSkillManagement({ userRoot: () => path.join(root, 'user'), catalog: () => [], changed: () => {} });
    const token = 'a'.repeat(64); const app = express();
    app.use((req, res, next) => { if (req.header('x-linnya-cli-token') !== token) res.sendStatus(401); else next(); });
    app.use('/api/v1/conversation-control', createConversationControlBridgeRouter({
      appInstanceId: 'skill-cli-instance', appVersion: 'test', diagnostics: { error() {} },
      useCase: { async execute(request) {
        if (request.command !== 'skills') throw new Error('test only supports skills');
        return controlSkills(owner, request.request);
      } },
    }));
    const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing server');
    const descriptor = path.join(root, 'connection.json');
    fs.writeFileSync(descriptor, JSON.stringify({ protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
      app_instance_id: 'skill-cli-instance', pid: process.pid, host: '127.0.0.1', port: address.port,
      session_token: token, created_at: 1, updated_at: 1 }));
    const invoke = (...args: string[]) => new Promise<{ code: number; out: string; error: string }>(resolve => {
      execFile(process.execPath, ['--import', 'tsx', 'apps/linnya-cli/src/main.ts', 'skills', ...args], {
        cwd: process.cwd(), env: { ...process.env, LINNYA_CLI_CONNECTION_FILE: descriptor },
      }, (error, stdout, stderr) => resolve({ code: error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
        out: stdout, error: stderr }));
    });
    try {
      expect((await invoke('install', 'cli-fixture', '--from', draft)).code).toBe(0);
      expect((await invoke('install', 'cli-fixture', '--from', draft)).code).toBe(6);
      expect((await invoke('edit', 'cli-fixture', '--old', 'Before', '--new', 'Edited')).code).toBe(0);
      expect((await invoke('read', 'cli-fixture')).out).toContain('Edited');
      fs.unlinkSync(path.join(draft, 'old.txt'));
      fs.writeFileSync(path.join(draft, 'new.txt'), 'new');
      expect((await invoke('update', 'cli-fixture', '--from', draft)).code).toBe(0);
      expect(fs.existsSync(path.join(root, 'user/cli-fixture/old.txt'))).toBe(false);
      const content = path.join(root, 'text.txt'); fs.writeFileSync(content, 'changed support');
      expect((await invoke('write', 'cli-fixture', 'new.txt', '--from', content)).code).toBe(0);
      expect(fs.readFileSync(path.join(root, 'user/cli-fixture/new.txt'), 'utf8')).toBe('changed support');
      expect((await invoke('list', '--from', draft)).code).toBe(2);
      expect((await invoke('remove', 'cli-fixture')).code).toBe(0);
      expect(fs.readdirSync(path.join(root, 'user'))).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import { createLocalSkillManagement } from '../adapters/createLocalSkillManagement';
import { createSkillManagementRouter } from '../skillManagement.router';
import { parseSkillFile } from '../frontmatter';
import { readSkillText } from '../shared/skillFiles';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-skills-life-')); roots.push(root);
  const user = path.join(root, 'user'); const draft = path.join(root, 'draft');
  fs.mkdirSync(draft);
  fs.writeFileSync(path.join(draft, 'SKILL.md'), '---\nname: lifecycle\ndescription: >-\n  A reusable\n  lifecycle test\n---\nOriginal instruction\n');
  fs.writeFileSync(path.join(draft, 'obsolete.txt'), 'old');
  let invalidations = 0;
  const owner = createLocalSkillManagement({ userRoot: () => user, catalog: () => [], changed: () => { invalidations++; } });
  return { root, user, draft, owner, invalidations: () => invalidations };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('current Skill file lifecycle', () => {
  it('安装→原文编辑→外部编辑冲突→完整升级→卸载，不留下历史', () => {
    const f = fixture();
    expect(f.owner.execute({ action: 'validate', source_directory: f.draft })).toMatchObject({ name: 'lifecycle' });
    f.owner.execute({ action: 'install', name: 'lifecycle', source_directory: f.draft });
    const target = path.join(f.user, 'lifecycle');
    expect(parseSkillFile(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'SKILL.md')?.frontmatter.description).toBe('A reusable lifecycle test');
    expect(() => f.owner.execute({ action: 'install', name: 'lifecycle', source_directory: f.draft })).toThrow('已安装');
    f.owner.execute({ action: 'edit', name: 'lifecycle', path: 'SKILL.md', old_string: 'Original instruction', new_string: 'Edited instruction' });
    const read = f.owner.execute({ action: 'read', name: 'lifecycle', path: 'SKILL.md' });
    if (read.action !== 'read') throw new Error('expected file');
    fs.appendFileSync(path.join(target, 'SKILL.md'), 'External edit\n');
    expect(() => f.owner.execute({ action: 'write', name: 'lifecycle', path: 'SKILL.md', content: read.content, expected_content: read.content })).toThrow('已改变');
    expect(() => f.owner.execute({ action: 'edit', name: 'lifecycle', path: 'SKILL.md', old_string: 'Edited instruction', new_string: '---broken---' })).not.toThrow();
    fs.unlinkSync(path.join(f.draft, 'obsolete.txt'));
    fs.writeFileSync(path.join(f.draft, 'new.txt'), 'new');
    f.owner.execute({ action: 'update', name: 'lifecycle', source_directory: f.draft });
    expect(fs.existsSync(path.join(target, 'obsolete.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(target, 'new.txt'), 'utf8')).toBe('new');
    expect(fs.readdirSync(f.user)).toEqual(['lifecycle']);
    f.owner.execute({ action: 'remove', name: 'lifecycle' });
    expect(f.owner.execute({ action: 'list' })).toEqual({ action: 'list', skills: [] });
    expect(fs.readdirSync(f.user)).toEqual([]);
    expect(f.invalidations()).toBe(5);
  });

  it('拒绝无效包、越界链接和过大资源，当前内容保持可读', () => {
    const f = fixture();
    f.owner.execute({ action: 'install', name: 'lifecycle', source_directory: f.draft });
    fs.writeFileSync(path.join(f.draft, 'SKILL.md'), 'broken');
    expect(() => f.owner.execute({ action: 'update', name: 'lifecycle', source_directory: f.draft })).toThrow('格式无效');
    expect(readSkillText(path.join(f.user, 'lifecycle'), 'SKILL.md')).toContain('Original instruction');
    fs.writeFileSync(path.join(f.root, 'outside.txt'), 'outside');
    fs.symlinkSync(path.join(f.root, 'outside.txt'), path.join(f.user, 'lifecycle', 'link.txt'));
    expect(() => readSkillText(path.join(f.user, 'lifecycle'), 'link.txt')).toThrow('普通文件');
    expect(() => readSkillText(path.join(f.user, 'lifecycle'), '../outside.txt')).toThrow('相对路径');
    fs.unlinkSync(path.join(f.user, 'lifecycle', 'link.txt'));
    fs.writeFileSync(path.join(f.user, 'lifecycle', 'large.txt'), 'x'.repeat(600 * 1024));
    expect(() => readSkillText(path.join(f.user, 'lifecycle'), 'large.txt')).toThrow('过大');
    expect(f.owner.execute({ action: 'list' })).toMatchObject({ skills: [{ available: false }] });
    f.owner.execute({ action: 'remove', name: 'lifecycle' });
  });

  it('真实 HTTP 管理流程返回当前文件与冲突，不在 UI 重写业务规则', async () => {
    const f = fixture(); const app = express(); app.use(express.json()); app.use('/skills', createSkillManagementRouter(f.owner));
    const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing server');
      const call = (request: unknown) => fetch(`http://127.0.0.1:${address.port}/skills`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      expect((await call({ action: 'install', name: 'lifecycle', source_directory: f.draft })).status).toBe(200);
      expect((await call({ action: 'install', name: 'lifecycle', source_directory: f.draft })).status).toBe(409);
      expect(await (await call({ action: 'read', name: 'lifecycle', path: 'obsolete.txt' })).json()).toMatchObject({ content: 'old' });
      expect((await call({ action: 'remove', name: 'lifecycle' })).status).toBe(200);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});

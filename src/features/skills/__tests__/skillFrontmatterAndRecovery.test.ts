import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalSkillManagement } from '../adapters/createLocalSkillManagement';
import { parseSkillFile } from '../frontmatter';
import {
  contextGrantsSkillAuthoring,
  toolListGrantsSkillAuthoring,
} from '../functions/canAuthorSkills';
import { inspectSkillFiles, readSkillText, readSkillTextLossy } from '../shared/skillFiles';

const roots: string[] = [];
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-skills-extra-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('SKILL.md frontmatter 宽松加载', () => {
  it('未加引号的 version、列表写法的 allowed-tools 都不会让 Skill 失效', () => {
    const parsed = parseSkillFile([
      '---', 'name: tolerant', 'description: 周报助手', 'metadata:', '  version: 1.0', '  author: someone',
      'allowed-tools:', '  - Bash', '  - Read', 'disable-model-invocation: true', '---', 'body',
    ].join('\n'), 'SKILL.md', 'tolerant');
    expect(parsed?.frontmatter).toMatchObject({
      name: 'tolerant',
      metadata: { version: '1.0', author: 'someone' },
      'allowed-tools': 'Bash Read',
      'disable-model-invocation': true,
    });
  });

  it('格式不对的可选字段被忽略，必填字段错误仍然拒绝', () => {
    const ignored = parseSkillFile('---\nname: odd\ndescription: ok\nmetadata:\n  nested:\n    deep: x\n---\nbody', 'SKILL.md', 'odd');
    expect(ignored?.frontmatter.metadata).toBeUndefined();
    expect(ignored?.frontmatter.name).toBe('odd');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(parseSkillFile('---\nname: odd\n---\nbody', 'SKILL.md', 'odd')).toBeNull();
  });
});

describe('Skill 文件检查不读取内容', () => {
  it('只做大小与类型检查：非法 UTF-8 的支持文件不拖垮发现，摘要读取使用宽松解码', () => {
    const dir = path.join(tempRoot(), 'skill');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: skill\ndescription: d\n---\n');
    fs.writeFileSync(path.join(dir, 'binary.bin'), Buffer.from([0xff, 0xfe, 0x41]));
    expect(inspectSkillFiles(dir).map(file => file.path)).toEqual(['binary.bin', 'SKILL.md']);
    expect(() => readSkillText(dir, 'binary.bin')).toThrow();
    expect(readSkillTextLossy(dir, 'binary.bin')).toBe('��A');
  });

  it('合法文本的宽松读取与严格读取逐字符一致，既有兼容摘要不变', () => {
    const dir = path.join(tempRoot(), 'skill');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '中文 skill 内容\n');
    expect(readSkillTextLossy(dir, 'SKILL.md')).toBe(readSkillText(dir, 'SKILL.md'));
  });

  it('超限文件在检查阶段就被拒绝，而不是读完再判断', () => {
    const dir = path.join(tempRoot(), 'skill');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'x');
    fs.writeFileSync(path.join(dir, 'large.txt'), 'x'.repeat(600 * 1024));
    const read = vi.spyOn(fs, 'readFileSync');
    expect(() => inspectSkillFiles(dir)).toThrow('过大');
    expect(read).not.toHaveBeenCalled();
  });
});

describe('被中断的整包升级', () => {
  function owner(user: string) {
    return createLocalSkillManagement({ userRoot: () => user, catalog: () => [], changed: () => undefined });
  }
  const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('旧版本已被挪走、新版本没落位时，下一次列表把旧版本放回', () => {
    const user = path.join(tempRoot(), 'user');
    fs.mkdirSync(path.join(user, `.replace-keep-me-${uuid}`), { recursive: true });
    fs.writeFileSync(path.join(user, `.replace-keep-me-${uuid}`, 'SKILL.md'), '---\nname: keep-me\ndescription: restored\n---\nbody');
    const result = owner(user).execute({ action: 'list' });
    expect(result).toMatchObject({ skills: [{ name: 'keep-me', description: 'restored', available: true }] });
    expect(fs.readdirSync(user)).toEqual(['keep-me']);
  });

  it('目标已经存在时只清理残留的临时目录', () => {
    const user = path.join(tempRoot(), 'user');
    fs.mkdirSync(path.join(user, 'present'), { recursive: true });
    fs.writeFileSync(path.join(user, 'present', 'SKILL.md'), '---\nname: present\ndescription: current\n---\nbody');
    fs.mkdirSync(path.join(user, `.replace-present-${uuid}`), { recursive: true });
    fs.mkdirSync(path.join(user, '.install-abandoned'), { recursive: true });
    owner(user).execute({ action: 'list' });
    expect(fs.readdirSync(user)).toEqual(['present']);
  });

  it('列表不读取支持文件内容', () => {
    const user = path.join(tempRoot(), 'user');
    fs.mkdirSync(path.join(user, 'quiet', 'references'), { recursive: true });
    fs.writeFileSync(path.join(user, 'quiet', 'SKILL.md'), '---\nname: quiet\ndescription: d\n---\nbody');
    fs.writeFileSync(path.join(user, 'quiet', 'references', 'a.md'), 'a');
    const read = vi.spyOn(fs, 'readFileSync');
    owner(user).execute({ action: 'list' });
    expect(read.mock.calls.map(([file]) => String(file)).filter(file => file.endsWith('a.md'))).toEqual([]);
  });
});

describe('维护 Skill 的能力来自工具名单', () => {
  it('持有 skill_manage 的 Agent 才能看到 skill-creator 并管理 Skill', () => {
    expect(toolListGrantsSkillAuthoring(['skill', 'skill_manage'])).toBe(true);
    expect(toolListGrantsSkillAuthoring(['skill'])).toBe(false);
    expect(toolListGrantsSkillAuthoring(undefined)).toBe(false);
    expect(contextGrantsSkillAuthoring({ registeredRootAllowedTools: ['skill_manage'] })).toBe(true);
    expect(contextGrantsSkillAuthoring({ registeredRootAllowedTools: ['skill_manage'], registeredChildAllowedTools: [] })).toBe(false);
    expect(contextGrantsSkillAuthoring({})).toBe(false);
  });
});

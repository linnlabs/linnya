import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  SkillManagementRequestSchema, type ManagedSkill, type SkillManagementRequest,
  type SkillManagementResult,
} from '@app/schemas';
import { SkillManagementError, type SkillManagementPort } from '../definitions/skillManagement';
import { parseSkillFile } from '../frontmatter';
import { computeSkillFileEdit } from '../functions/computeSkillFileEdit';
import { listSkillFiles, readSkillText, resolveSkillFile } from '../shared/skillFiles';
import type { SkillMetadata } from '../types';

interface SkillManagementDependencies {
  readonly userRoot: () => string;
  readonly catalog: () => readonly SkillMetadata[];
  readonly changed: () => void;
}

function invalid(message: string): never { throw new SkillManagementError('invalid_skill', message); }

/** 只有当前文件，没有修订库。同步完成一次小包操作，避免在改名间隙交出事件循环。 */
export function createLocalSkillManagement(dependencies: SkillManagementDependencies): SkillManagementPort {
  function root(): string {
    const directory = dependencies.userRoot();
    fs.mkdirSync(directory, { recursive: true });
    if (fs.lstatSync(directory).isSymbolicLink()) invalid('用户 Skill 根不能是符号链接');
    return directory;
  }
  function userDirectory(name: string): string {
    const directory = resolveSkillFile(root(), name);
    if (!fs.existsSync(directory)) throw new SkillManagementError('not_found', `用户 Skill「${name}」不存在`);
    if (!fs.lstatSync(directory).isDirectory()) invalid('用户 Skill 必须是普通目录');
    return directory;
  }
  function packageFiles(directory: string, expectedName?: string) {
    if (!path.isAbsolute(directory)) invalid('来源目录必须使用本机绝对路径');
    const files = listSkillFiles(directory);
    const raw = readSkillText(directory, 'SKILL.md');
    const parsed = parseSkillFile(raw, 'SKILL.md', expectedName);
    if (!parsed) invalid('SKILL.md 格式无效，请检查 name、description 和 YAML');
    const contents = files.map(file => ({ path: file, content: readSkillText(directory, file) }));
    if (contents.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0) > 5 * 1024 * 1024) {
      invalid('Skill 内容总量不能超过 5 MiB');
    }
    return { name: parsed.frontmatter.name, description: parsed.frontmatter.description, files, contents };
  }
  /** 列表只需要描述与文件清单：读取入口文件，其余文件只做类型和大小检查。 */
  function describeUserSkill(directory: string, expectedName: string) {
    const files = listSkillFiles(directory);
    const parsed = parseSkillFile(readSkillText(directory, 'SKILL.md'), 'SKILL.md', expectedName);
    if (!parsed) invalid('SKILL.md 格式无效，请检查 name、description 和 YAML');
    return { description: parsed.frontmatter.description, files };
  }
  /** 上一次替换被强杀时可能留下临时目录：旧版本已被挪走则放回，否则清掉。 */
  function recoverInterrupted(): void {
    const directory = root();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(directory, entry.name);
      const displaced = /^\.replace-(.+)-[0-9a-f-]{36}$/u.exec(entry.name);
      if (displaced?.[1] && !fs.existsSync(path.join(directory, displaced[1]))) {
        fs.renameSync(full, path.join(directory, displaced[1]));
      } else if (displaced || entry.name.startsWith('.install-')) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  }
  function list(): ManagedSkill[] {
    recoverInterrupted();
    const catalog = dependencies.catalog();
    const entries: ManagedSkill[] = catalog.filter(skill => skill.source !== 'user').map(skill => ({
      name: skill.name, description: skill.description, source: skill.source,
      available: true, files: listSkillFiles(skill.directory),
    }));
    for (const entry of fs.readdirSync(root(), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      try {
        const skill = describeUserSkill(userDirectory(entry.name), entry.name);
        const shadowed = catalog.some(item => item.name === entry.name && item.source !== 'user');
        entries.push({ name: entry.name, description: skill.description, source: 'user', files: skill.files,
          available: !shadowed, ...(shadowed ? { error: '同名内置或插件 Skill 优先；请重命名用户 Skill' } : {}) });
      } catch (error: unknown) {
        entries.push({ name: entry.name, description: '', source: 'user', available: false, files: ['SKILL.md'],
          error: error instanceof Error ? error.message : '无法读取 Skill' });
      }
    }
    return entries;
  }
  function saveFile(request: Extract<SkillManagementRequest, { action: 'write' | 'edit' }>): void {
    const directory = userDirectory(request.name);
    const target = resolveSkillFile(directory, request.path);
    const previous = fs.existsSync(target) ? readSkillText(directory, request.path) : null;
    const content = computeSkillFileEdit(request, previous);
    if (previous === null && listSkillFiles(directory).length >= 51) invalid('Skill 最多包含 50 个支持文件');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  function replacePackage(request: Extract<SkillManagementRequest, { action: 'install' | 'update' }>): void {
    const validated = packageFiles(request.source_directory, request.name);
    const directory = resolveSkillFile(root(), request.name);
    const exists = fs.existsSync(directory);
    if (request.action === 'install' && exists) throw new SkillManagementError('conflict', 'Skill 已安装；升级请使用 update');
    if (request.action === 'update') userDirectory(request.name);
    if (dependencies.catalog().some(skill => skill.name === request.name && skill.source !== 'user')) {
      throw new SkillManagementError('conflict', '不能覆盖同名内置或插件 Skill，请更换名称');
    }
    if (!exists && fs.readdirSync(root()).filter(name => !name.startsWith('.')).length >= 100) invalid('最多安装 100 个用户 Skill');
    recoverInterrupted();
    const staging = path.join(root(), `.install-${randomUUID()}`);
    const displaced = path.join(root(), `.replace-${request.name}-${randomUUID()}`);
    fs.mkdirSync(staging);
    try {
      for (const file of validated.contents) {
        const target = path.join(staging, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content, 'utf8');
      }
      if (exists) fs.renameSync(directory, displaced);
      try {
        fs.renameSync(staging, directory);
      } catch (error: unknown) {
        // 普通替换失败时保住当前文件；临时旧目录仅服务这次写入，不保留版本历史。
        if (exists) fs.renameSync(displaced, directory);
        throw error;
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    fs.rmSync(displaced, { recursive: true, force: true });
  }
  function executeParsed(request: SkillManagementRequest): SkillManagementResult {
    switch (request.action) {
      case 'list': return { action: 'list', skills: list() };
      case 'read': {
        const user = request.source === 'user' || (request.source === undefined && fs.existsSync(path.join(root(), request.name)));
        const skill = dependencies.catalog().find(item => item.name === request.name
          && (request.source === undefined || item.source === request.source));
        const directory = user ? userDirectory(request.name) : skill?.directory;
        if (!directory) throw new SkillManagementError('not_found', 'Skill 不存在');
        return { action: 'read', name: request.name, path: request.path,
          content: readSkillText(directory, request.path), source: user ? 'user' : skill?.source ?? 'user' };
      }
      case 'validate': {
        const validated = packageFiles(request.source_directory);
        return { action: 'validate', name: validated.name, description: validated.description,
          files: validated.files };
      }
      case 'install': case 'update': replacePackage(request); break;
      case 'remove': fs.rmSync(userDirectory(request.name), { recursive: true }); break;
      case 'write': case 'edit': saveFile(request); break;
      case 'delete_file': {
        if (request.path === 'SKILL.md') invalid('移除 SKILL.md 请卸载整个 Skill');
        const target = resolveSkillFile(userDirectory(request.name), request.path);
        if (!fs.existsSync(target)) throw new SkillManagementError('not_found', '文件不存在');
        if (!fs.lstatSync(target).isFile()) invalid('只能删除普通文件');
        fs.unlinkSync(target);
        break;
      }
    }
    dependencies.changed();
    return { action: request.action, name: request.name };
  }
  return {
    execute(input) {
      const request = SkillManagementRequestSchema.parse(input);
      try { return executeParsed(request); }
      catch (error: unknown) {
        if (error instanceof SkillManagementError) throw error;
        throw new SkillManagementError('invalid_skill', error instanceof Error ? error.message : 'Skill 文件操作失败');
      }
    },
  };
}

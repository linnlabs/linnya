// @vitest-environment jsdom
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedSkill, SkillManagementRequest, SkillManagementResult } from '@app/schemas';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), confirm: vi.fn(), pick: vi.fn() }));
vi.mock('../infrastructure/skillManagementGateway', () => ({ executeSkillManagement: mocks.execute }));
vi.mock('../infrastructure/skillFolderPicker', () => ({ pickSkillFolder: mocks.pick }));
vi.mock('@shared/composables/confirmDialog', () => ({ confirm: mocks.confirm }));
import SkillManagementSettingsPage from '../ui/SkillManagementSettingsPage.vue';

let app: App | undefined; let container: HTMLDivElement;
const mine: ManagedSkill = { name: 'weekly-report', description: '起草团队周报', source: 'user', available: true, files: ['SKILL.md', 'references/template.md'] };
const bundled: ManagedSkill = { name: 'deep-research', description: 'Research and write', source: 'builtin', available: true, files: ['SKILL.md'] };

async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }
function buttons(): HTMLButtonElement[] { return [...document.body.querySelectorAll('button')]; }
function button(text: string): HTMLButtonElement {
  const found = buttons().find(item => (item.textContent?.trim() || item.getAttribute('aria-label')) === text);
  if (!found) throw new Error(`missing button: ${text}`); return found;
}
function rowButton(name: string): HTMLButtonElement {
  const found = document.body.querySelector<HTMLButtonElement>('.skills-row .skills-row-name')
    ? [...document.body.querySelectorAll<HTMLButtonElement>('.skills-row')].find(item => item.querySelector('.skills-row-name')?.textContent === name)
    : undefined;
  if (!found) throw new Error(`missing row: ${name}`); return found;
}
function hasButton(text: string): boolean { return buttons().some(item => item.textContent?.trim() === text); }
function editor(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('.text-file-editor-control'); if (!found) throw new Error('no editor'); return found;
}
function fileText(): string | null { return editor().querySelector('[data-node-view-content]')?.textContent ?? null; }
function type(value: string) {
  const field = editor().querySelector('[data-node-view-content]');
  if (!field) throw new Error('no text file');
  field.textContent = value;
  field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

interface Backend { skills: ManagedSkill[]; files: Record<string, string>; validated?: { name: string; description: string; files: string[] } }
function backend(initial: Partial<Backend> = {}): Backend {
  const state: Backend = { skills: [mine, bundled], files: { 'weekly-report/SKILL.md': 'original', 'weekly-report/references/template.md': 'template' }, ...initial };
  mocks.execute.mockImplementation(async (request: SkillManagementRequest): Promise<SkillManagementResult> => {
    switch (request.action) {
      case 'list': return { action: 'list', skills: state.skills };
      case 'read': return { action: 'read', name: request.name, path: request.path, source: request.source ?? 'user', content: state.files[`${request.name}/${request.path}`] ?? '' };
      case 'validate': return { action: 'validate', ...(state.validated ?? { name: 'weekly-report', description: '起草团队周报', files: ['SKILL.md'] }) };
      case 'remove': state.skills = state.skills.filter(skill => skill.name !== request.name); return { action: 'remove', name: request.name };
      case 'write': state.files[`${request.name}/${request.path}`] = request.content; return { action: 'write', name: request.name };
      default: return { action: request.action, name: request.name } as SkillManagementResult;
    }
  });
  return state;
}
beforeEach(() => {
  mocks.execute.mockReset(); mocks.confirm.mockReset(); mocks.pick.mockReset(); mocks.confirm.mockResolvedValue(true);
  container = document.createElement('div'); document.body.append(container);
});
afterEach(() => { app?.unmount(); app = undefined; container.remove(); document.body.innerHTML = ''; });
async function mount() {
  app = createApp({ render: () => h(SkillManagementSettingsPage) }); app.use(createPinia()); app.mount(container); await flush();
}
async function openMine() { rowButton('weekly-report').click(); await flush(); container.querySelector<HTMLElement>('.skills-preview-card')?.click(); await flush(); }
const writes = () => mocks.execute.mock.calls.map(([request]) => request as SkillManagementRequest).filter(request => request.action !== 'list' && request.action !== 'read' && request.action !== 'validate');

describe('Skill 设置页', () => {
  it('支持文件的切换、编辑、保存和读取失败都不会改变卡片中的入口文件，重新打开仍从入口开始', async () => {
    backend(); await mount(); await openMine();
    const previewText = () => container.querySelector('.skills-preview-card')?.textContent;
    button('template.md').click(); await flush();
    expect(fileText()).toBe('template');
    expect(previewText()).toContain('original');
    type('updated template'); await flush();
    button('保存').click(); await flush();
    expect(fileText()).toBe('updated template');
    expect(previewText()).toContain('original');
    expect(previewText()).not.toContain('updated template');
    button('完成').click(); await flush();
    container.querySelector<HTMLElement>('.skills-preview-card')?.click(); await flush();
    expect(fileText()).toBe('original');
    mocks.execute.mockRejectedValueOnce(new Error('支持文件读取失败'));
    button('template.md').click(); await flush();
    expect(document.body.textContent).toContain('支持文件读取失败');
    expect(previewText()).toContain('original');
    expect(container.querySelector('.skills-preview-meta')?.textContent).toContain('SKILL.md');
  });

  it('先展示正文预览，隐藏 YAML 头；点击预览才编辑，切换预览不写入或丢失草稿', async () => {
    const source = '---\nname: weekly-report\ndescription: 起草团队周报\n---\n# 周报\n\n- 进度\n- 风险\n';
    backend({ files: { 'weekly-report/SKILL.md': source } }); await mount();
    expect(container.querySelector('.skills-preview-card h1')?.textContent).toBe('周报');
    expect(container.querySelector('h2')?.textContent).toBe('已安装的 Skill');
    expect(container.querySelector('.settings-page-description')).toBeNull();
    expect(container.querySelector('.skills-preview-card')?.textContent).not.toContain('name:');
    expect(document.body.querySelector('.text-file-editor')).toBeNull();
    const preview = container.querySelector<HTMLElement>('.skills-preview-card');
    preview?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await flush();
    expect(fileText()).toBe(source);
    expect(button('保存').disabled).toBe(true);
    type(source + '\n新增内容'); await flush();
    button('预览').click(); await flush();
    expect(document.body.querySelector('.skills-editor-preview')?.textContent).toContain('新增内容');
    button('原文').click(); await flush();
    expect(fileText()).toBe(source + '\n新增内容');
    expect(writes()).toEqual([]);
    button('完成').click(); await flush();
    expect(container.querySelector('.skills-preview-card')?.textContent).not.toContain('新增内容');
  });

  it('按来源分组并显示每个 Skill 的描述；没有自己的 Skill 时给出引导', async () => {
    backend({ skills: [bundled] }); await mount();
    expect(container.textContent).toContain('我的 Skill');
    expect(container.textContent).toContain('还没有自己的 Skill');
    expect(container.textContent).toContain('deep-research');
    expect(container.textContent).toContain('Research and write');
  });

  it('不可用的 Skill 把原因放在描述位置并带标记', async () => {
    backend({ skills: [{ ...mine, available: false, error: 'SKILL.md 格式无效' }] }); await mount();
    expect(container.textContent).toContain('SKILL.md 格式无效');
    expect(container.textContent).toContain('不可用');
  });

  it('打开详情后编辑并保存；冲突时保留编辑并在弹窗底部显示原因', async () => {
    backend(); await mount(); await openMine();
    expect(document.body.textContent).toContain('references');
    type('edited');
    await flush();
    mocks.execute.mockImplementationOnce(async () => ({ action: 'list', skills: [mine, bundled] }));
    mocks.execute.mockRejectedValueOnce(new Error('file changed externally'));
    mocks.execute.mockImplementation(async (request: SkillManagementRequest) => {
      if (request.action === 'write') throw new Error('file changed externally');
      return { action: 'list', skills: [mine, bundled] };
    });
    button('保存').click(); await flush();
    expect(writes()).toEqual([{ action: 'write', name: 'weekly-report', path: 'SKILL.md', content: 'edited', expected_content: 'original' }]);
    expect(fileText()).toBe('edited');
    expect(document.body.textContent).toContain('file changed externally');
  });

  it('保存成功后重新读取当前文件并提示结果', async () => {
    const state = backend(); await mount(); await openMine();
    type('edited'); await flush();
    mocks.execute.mockImplementation(async (request: SkillManagementRequest): Promise<SkillManagementResult> => {
      if (request.action === 'write') { state.files['weekly-report/SKILL.md'] = request.content; return { action: 'write', name: request.name }; }
      if (request.action === 'list') return { action: 'list', skills: state.skills };
      if (request.action === 'read') return { action: 'read', name: request.name, path: request.path, source: 'user', content: state.files['weekly-report/SKILL.md'] ?? '' };
      throw new Error('unexpected');
    });
    button('保存').click(); await flush();
    expect(document.body.textContent).toContain('已保存');
    expect(fileText()).toBe('edited');
    expect(button('保存').disabled).toBe(true);
    expect(container.querySelector('.skills-preview-card')?.textContent).toContain('edited');
  });

  it('切换支持文件读取对应内容；有未保存修改时先确认，取消则留在原文件', async () => {
    backend(); await mount(); await openMine();
    type('dirty'); await flush();
    mocks.confirm.mockResolvedValueOnce(false);
    button('template.md').click(); await flush();
    expect(fileText()).toBe('dirty');
    mocks.confirm.mockResolvedValueOnce(true);
    button('template.md').click(); await flush();
    expect(fileText()).toBe('template');
  });

  it('关闭有未保存修改的详情需要确认', async () => {
    backend(); await mount(); await openMine();
    type('dirty'); await flush();
    mocks.confirm.mockResolvedValueOnce(false);
    button('关闭').click(); await flush();
    expect(document.body.querySelector('.text-file-editor')).not.toBeNull();
    mocks.confirm.mockResolvedValueOnce(true);
    button('关闭').click(); await flush();
    expect(document.body.querySelector('.text-file-editor')).toBeNull();
    expect(container.querySelector('.skills-preview-card')?.textContent).toContain('original');
  });

  it('内置 Skill 只读，没有保存、升级、卸载', async () => {
    backend(); await mount(); rowButton('deep-research').click(); await flush(); container.querySelector<HTMLElement>('.skills-preview-card')?.click(); await flush();
    expect(editor().getAttribute('contenteditable')).toBe('false');
    expect(hasButton('卸载') || hasButton('保存') || hasButton('从文件夹升级…')).toBe(false);
    expect(document.body.textContent).toContain('只能查看');
  });

  it('从文件夹安装：校验后确认，用文件夹里的名称安装；已存在同名 Skill 时按升级处理', async () => {
    const state = backend({ skills: [bundled], validated: { name: 'pdf-tables', description: '抽取 PDF 表格', files: ['SKILL.md', 'a.md'] } });
    mocks.pick.mockResolvedValue({ status: 'selected', path: '/Users/me/pdf-tables' });
    await mount(); button('从文件夹安装…').click(); await flush();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '安装 Skill', sections: [{ title: 'pdf-tables · 2 个文件', items: ['抽取 PDF 表格', '/Users/me/pdf-tables'] }],
    }));
    expect(writes()).toEqual([{ action: 'install', name: 'pdf-tables', source_directory: '/Users/me/pdf-tables' }]);
    expect(container.textContent).toContain('已安装 Skill「pdf-tables」');

    state.skills = [bundled, { ...mine, name: 'pdf-tables' }];
    button('刷新').click(); await flush();
    mocks.execute.mockClear(); mocks.confirm.mockClear();
    button('从文件夹安装…').click(); await flush();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '替换已有 Skill', isDangerousAction: true }));
    expect(writes()).toEqual([{ action: 'update', name: 'pdf-tables', source_directory: '/Users/me/pdf-tables' }]);
  });

  it('取消文件夹选择或取消确认都不写入；校验失败显示原因', async () => {
    backend(); await mount();
    mocks.pick.mockResolvedValueOnce({ status: 'canceled' });
    button('从文件夹安装…').click(); await flush();
    mocks.pick.mockResolvedValueOnce({ status: 'selected', path: '/x' }); mocks.confirm.mockResolvedValueOnce(false);
    button('从文件夹安装…').click(); await flush();
    expect(writes()).toEqual([]);
    mocks.pick.mockResolvedValueOnce({ status: 'selected', path: '/bad' });
    mocks.execute.mockImplementation(async (request: SkillManagementRequest) => {
      if (request.action === 'validate') throw new Error('SKILL.md 格式无效');
      return { action: 'list', skills: [mine] };
    });
    button('从文件夹安装…').click(); await flush();
    expect(container.textContent).toContain('SKILL.md 格式无效');
    mocks.pick.mockResolvedValueOnce({ status: 'unavailable' });
    button('从文件夹安装…').click(); await flush();
    expect(container.textContent).toContain('无法打开文件夹选择器');
  });

  it('升级：文件夹里的名称与当前 Skill 不一致时拒绝，一致时确认后替换', async () => {
    const state = backend(); await mount(); await openMine();
    mocks.pick.mockResolvedValue({ status: 'selected', path: '/Users/me/other' });
    state.validated = { name: 'other-skill', description: 'x', files: ['SKILL.md'] };
    button('从文件夹升级…').click(); await flush();
    expect(document.body.textContent).toContain('「other-skill」，与当前 Skill「weekly-report」不一致');
    expect(writes()).toEqual([]);
    state.validated = { name: 'weekly-report', description: '起草团队周报', files: ['SKILL.md'] };
    button('从文件夹升级…').click(); await flush();
    expect(writes()).toEqual([{ action: 'update', name: 'weekly-report', source_directory: '/Users/me/other' }]);
  });

  it('卸载需要确认；确认后关闭详情并从列表移除', async () => {
    backend(); await mount(); await openMine();
    mocks.confirm.mockResolvedValueOnce(false);
    button('卸载').click(); await flush();
    expect(writes()).toEqual([]);
    button('卸载').click(); await flush();
    expect(writes()).toEqual([{ action: 'remove', name: 'weekly-report' }]);
    expect(document.body.querySelector('.text-file-editor')).toBeNull();
    expect([...container.querySelectorAll('.skills-row-name')].map(item => item.textContent)).toEqual(['deep-research']);
  });

  it('窗口重新获得焦点时静默刷新：外部修改会读入，未保存的编辑不被覆盖，外部卸载会关闭详情', async () => {
    const state = backend(); await mount(); await openMine();
    state.files['weekly-report/SKILL.md'] = 'edited externally';
    window.dispatchEvent(new Event('focus')); await flush();
    expect(fileText()).toBe('edited externally');
    type('my draft'); await flush();
    state.files['weekly-report/SKILL.md'] = 'changed again';
    window.dispatchEvent(new Event('focus')); await flush();
    expect(fileText()).toBe('my draft');
    state.skills = [bundled]; type('edited externally'); await flush();
    window.dispatchEvent(new Event('focus')); await flush();
    expect(document.body.querySelector('.text-file-editor')).toBeNull();
    expect([...container.querySelectorAll('.skills-row-name')].map(item => item.textContent)).toEqual(['deep-research']);
  });
});

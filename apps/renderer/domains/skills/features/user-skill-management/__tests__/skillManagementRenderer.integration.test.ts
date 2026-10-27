// @vitest-environment jsdom
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillManagementRequest, SkillManagementResult } from '@app/schemas';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), confirm: vi.fn() }));
vi.mock('../infrastructure/skillManagementGateway', () => ({ executeSkillManagement: mocks.execute }));
vi.mock('@shared/composables/confirmDialog', () => ({ confirm: mocks.confirm }));
import SkillManagementSettingsPage from '../ui/SkillManagementSettingsPage.vue';

let app: App | undefined; let container: HTMLDivElement;
const skill = { name: 'editable-skill', description: 'test', source: 'user' as const, available: true, files: ['SKILL.md'] };
async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent?.trim().startsWith(text));
  if (!found) throw new Error(`missing button: ${text}`); return found;
}
beforeEach(() => {
  mocks.execute.mockReset(); mocks.confirm.mockReset(); mocks.confirm.mockResolvedValue(true);
  container = document.createElement('div'); document.body.append(container);
});
afterEach(() => { app?.unmount(); app = undefined; container.remove(); });
async function mount() {
  app = createApp({ render: () => h(SkillManagementSettingsPage) }); app.use(createPinia()); app.mount(container); await flush();
}

describe('Skill settings current-file workflow', () => {
  it('选择当前文件、保存原文条件；冲突保留编辑，取消卸载不删除', async () => {
    mocks.execute.mockImplementation(async (request: SkillManagementRequest): Promise<SkillManagementResult> => {
      if (request.action === 'list') return { action: 'list', skills: [skill] };
      if (request.action === 'read') return { action: 'read', name: skill.name, path: 'SKILL.md', source: 'user', content: 'original' };
      throw new Error('file changed externally');
    });
    await mount(); button('editable-skill').click(); await flush();
    const editor = container.querySelector('textarea'); if (!editor) throw new Error('no editor');
    editor.value = 'edited'; editor.dispatchEvent(new Event('input', { bubbles: true })); await flush();
    button('保存文件').click(); await flush();
    expect(mocks.execute).toHaveBeenCalledWith({ action: 'write', name: skill.name, path: 'SKILL.md', content: 'edited', expected_content: 'original' });
    expect(editor.value).toBe('edited'); expect(container.textContent).toContain('file changed externally');
    mocks.confirm.mockResolvedValue(false); button('卸载').click(); await flush();
    expect(mocks.execute.mock.calls.filter(([request]) => request.action === 'remove')).toHaveLength(0);
  });
  it('内置来源只查看，不能保存/升级/卸载', async () => {
    mocks.execute.mockImplementation(async (request: SkillManagementRequest): Promise<SkillManagementResult> => request.action === 'list'
      ? { action: 'list', skills: [{ ...skill, source: 'builtin' }] }
      : { action: 'read', name: skill.name, path: 'SKILL.md', source: 'builtin', content: 'bundled' });
    await mount(); button('editable-skill').click(); await flush();
    expect(container.querySelector('textarea')?.readOnly).toBe(true);
    expect([...container.querySelectorAll('button')].some(item => item.textContent?.trim() === '卸载')).toBe(false);
  });
  it('文件选择器显示当前路径，切换支持文件后读取对应内容', async () => {
    mocks.execute.mockImplementation(async (request: SkillManagementRequest): Promise<SkillManagementResult> => {
      if (request.action === 'list') return { action: 'list', skills: [{ ...skill, files: ['SKILL.md', 'references/example.txt'] }] };
      if (request.action === 'read') return { action: 'read', name: skill.name, path: request.path, source: 'user', content: request.path };
      throw new Error('unexpected mutation');
    });
    await mount(); button('editable-skill').click(); await flush();
    const picker = container.querySelector<HTMLButtonElement>('button[aria-label="文件"]');
    if (!picker) throw new Error('missing file picker');
    expect(picker.textContent).toContain('SKILL.md');
    picker.click(); await flush();
    const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')]
      .find(item => item.textContent?.includes('references/example.txt'));
    if (!option) throw new Error('missing support file option');
    option.click(); await flush();
    expect(mocks.execute).toHaveBeenLastCalledWith({ action: 'read', name: skill.name, path: 'references/example.txt', source: 'user' });
    expect(picker.textContent).toContain('references/example.txt');
    expect(container.querySelector('textarea')?.value).toBe('references/example.txt');
  });
  it('外部修改后刷新读取当前内容，外部卸载后刷新清除旧编辑目标', async () => {
    let installed = true; let content = 'original';
    mocks.execute.mockImplementation(async (request: SkillManagementRequest): Promise<SkillManagementResult> => {
      if (request.action === 'list') return { action: 'list', skills: installed ? [skill] : [] };
      if (request.action === 'read') return { action: 'read', name: skill.name, path: request.path, source: 'user', content };
      throw new Error('unexpected mutation');
    });
    await mount(); button('editable-skill').click(); await flush();
    content = 'edited externally'; button('刷新').click(); await flush();
    expect(container.querySelector('textarea')?.value).toBe(content);
    installed = false; button('刷新').click(); await flush();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toContain('editable-skill');
  });
});

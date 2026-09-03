import { describe, expect, it } from 'vitest';
import {
  buildProjectMenuOptions,
  isDefaultWorkspaceProject,
  isProjectDeleteDisabled,
} from './projectMenuModel';
import { WORKSPACE_MESSAGE_FALLBACKS } from '@/domains/workspace/definitions/workspaceMessageCatalog';

const message = (key: keyof typeof WORKSPACE_MESSAGE_FALLBACKS): string => WORKSPACE_MESSAGE_FALLBACKS[key];

describe('projectMenuModel', () => {
  it('默认项目禁用删除菜单项', () => {
    const project = { canDelete: false, systemRole: 'default' as const };
    const options = buildProjectMenuOptions(project, message);

    expect(options[0]).toMatchObject({ value: 'overview', text: '项目概览' });
    expect(isDefaultWorkspaceProject(project)).toBe(true);
    expect(isProjectDeleteDisabled(project)).toBe(true);
    expect(options.find(option => option.value === 'delete')).toMatchObject({
      disabled: true,
      variant: 'danger',
    });
  });

  it('普通项目允许删除', () => {
    const project = { canDelete: true, systemRole: null };
    const options = buildProjectMenuOptions(project, message);

    expect(options.map(option => option.value)).toEqual(['overview', 'edit', 'delete']);
    expect(isDefaultWorkspaceProject(project)).toBe(false);
    expect(isProjectDeleteDisabled(project)).toBe(false);
    expect(options.find(option => option.value === 'delete')).toMatchObject({
      disabled: false,
      variant: 'danger',
    });
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensurePluginSkillAvailabilityRegistered } from '../../../app-hosts/linnya/plugin-registry/skillAvailability';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import {
  buildSkillCatalogXml,
  loadSkillContent,
  readSkillResource,
} from '../catalog';
import { invalidateSkillCache } from '../discovery';
import {
  clearPluginSkillSourceRootsForTests,
  replacePluginSkillSourceRoots,
} from '../pluginSkillSources';

const tempRoots: string[] = [];
const ORIGINAL_LINNYA_DEV_MODE = process.env.LINNYA_DEV_MODE;

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-skill-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeSkill(root: string, skillName: string, options: {
  readonly description?: string;
  readonly body?: string;
  readonly metadata?: readonly string[];
  readonly resource?: {
    readonly path: string;
    readonly content: string;
  };
} = {}): void {
  writeFile(
    path.join(root, skillName, 'SKILL.md'),
    [
      '---',
      `name: ${skillName}`,
      `description: ${options.description ?? `${skillName} plugin skill`}`,
      ...(options.metadata && options.metadata.length > 0
        ? ['metadata:', ...options.metadata.map((entry) => `  ${entry}`)]
        : []),
      '---',
      '',
      options.body ?? `# ${skillName}`,
      '',
    ].join('\n'),
  );

  if (options.resource) {
    writeFile(
      path.join(root, skillName, options.resource.path),
      options.resource.content,
    );
  }
}

afterEach(() => {
  if (ORIGINAL_LINNYA_DEV_MODE === undefined) {
    delete process.env.LINNYA_DEV_MODE;
  } else {
    process.env.LINNYA_DEV_MODE = ORIGINAL_LINNYA_DEV_MODE;
  }
  clearPluginRuntimeStateForTests();
  clearPluginSkillSourceRootsForTests();
  invalidateSkillCache();
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('plugin Skill sources', () => {
  it('discovers enabled plugin skills and reads their resources through the normal catalog path', () => {
    ensurePluginSkillAvailabilityRegistered();
    const tempRoot = makeTempRoot();
    const skillRoot = path.join(tempRoot, 'resources', 'skills');
    writeSkill(skillRoot, 'demo-plugin-skill', {
      description: 'Demo plugin skill for catalog/resource tests',
      body: '# Demo Plugin Skill\n\nUse the plugin workflow.',
      resource: {
        path: 'references/guide.md',
        content: '# Guide\n\nPlugin resource body.',
      },
    });

    replacePluginSkillSourceRoots([{ pluginId: 'demo-plugin', root: skillRoot }]);
    setPluginRuntimeStateForTests({
      installedPluginIds: ['demo-plugin'],
      enabledPluginIds: ['demo-plugin'],
    });
    invalidateSkillCache();

    expect(buildSkillCatalogXml()).toContain(
      '<skill name="demo-plugin-skill">Demo plugin skill for catalog/resource tests</skill>',
    );
    expect(buildSkillCatalogXml()).not.toContain('The following skills');
    expect(buildSkillCatalogXml()).not.toContain('action "activate"');

    const content = loadSkillContent('demo-plugin-skill');
    expect(content.source).toBe('plugin');
    expect(content.body).toContain('Use the plugin workflow.');
    expect(content.resources).toContain('references/guide.md');
    expect(readSkillResource('demo-plugin-skill', 'references/guide.md')).toContain('Plugin resource body.');
  });

  it('hides plugin skills when the owning plugin is disabled', () => {
    ensurePluginSkillAvailabilityRegistered();
    const tempRoot = makeTempRoot();
    const skillRoot = path.join(tempRoot, 'resources', 'skills');
    writeSkill(skillRoot, 'disabled-plugin-skill');
    replacePluginSkillSourceRoots([{ pluginId: 'demo-plugin', root: skillRoot }]);

    setPluginRuntimeStateForTests({
      installedPluginIds: ['demo-plugin'],
      enabledPluginIds: [],
    });
    invalidateSkillCache();

    expect(buildSkillCatalogXml()).not.toContain('disabled-plugin-skill');
    expect(() => loadSkillContent('disabled-plugin-skill')).toThrow(/找不到 Skill "disabled-plugin-skill"/);
  });

  it('exposes sheet-analyst only through the enabled Sheet plugin source', () => {
    ensurePluginSkillAvailabilityRegistered();
    const tempRoot = makeTempRoot();
    const skillRoot = path.join(tempRoot, 'resources', 'skills');
    writeSkill(skillRoot, 'sheet-analyst', {
      description: 'Plugin Sheet skill from the Sheet plugin',
      body: '# Plugin Sheet Skill',
      metadata: ['pluginId: sheet'],
    });

    replacePluginSkillSourceRoots([{ pluginId: 'sheet', root: skillRoot }]);
    setPluginRuntimeStateForTests({
      installedPluginIds: ['sheet'],
      enabledPluginIds: [],
    });
    invalidateSkillCache();

    expect(buildSkillCatalogXml()).not.toContain('sheet-analyst');
    expect(() => loadSkillContent('sheet-analyst')).toThrow(/找不到 Skill "sheet-analyst"/);

    setPluginRuntimeStateForTests({
      installedPluginIds: ['sheet'],
      enabledPluginIds: ['sheet'],
    });
    invalidateSkillCache();

    expect(buildSkillCatalogXml()).toContain(
      '<skill name="sheet-analyst">Plugin Sheet skill from the Sheet plugin</skill>',
    );
    const content = loadSkillContent('sheet-analyst');
    expect(content.source).toBe('plugin');
    expect(content.body).toContain('Plugin Sheet Skill');
  });

  it('refreshes plugin skill metadata immediately in development mode', () => {
    ensurePluginSkillAvailabilityRegistered();
    process.env.LINNYA_DEV_MODE = 'true';
    const tempRoot = makeTempRoot();
    const skillRoot = path.join(tempRoot, 'resources', 'skills');
    replacePluginSkillSourceRoots([{ pluginId: 'demo-plugin', root: skillRoot }]);
    setPluginRuntimeStateForTests({
      installedPluginIds: ['demo-plugin'],
      enabledPluginIds: ['demo-plugin'],
    });

    writeSkill(skillRoot, 'hot-plugin-skill', {
      description: 'First description',
    });
    expect(buildSkillCatalogXml()).toContain('First description');

    writeSkill(skillRoot, 'hot-plugin-skill', {
      description: 'Second description',
    });
    expect(buildSkillCatalogXml()).toContain('Second description');
  });

  it('keeps production skill discovery cached until explicitly invalidated', () => {
    ensurePluginSkillAvailabilityRegistered();
    delete process.env.LINNYA_DEV_MODE;
    const tempRoot = makeTempRoot();
    const skillRoot = path.join(tempRoot, 'resources', 'skills');
    replacePluginSkillSourceRoots([{ pluginId: 'demo-plugin', root: skillRoot }]);
    setPluginRuntimeStateForTests({
      installedPluginIds: ['demo-plugin'],
      enabledPluginIds: ['demo-plugin'],
    });

    writeSkill(skillRoot, 'cached-plugin-skill', {
      description: 'Cached first description',
    });
    expect(buildSkillCatalogXml()).toContain('Cached first description');

    writeSkill(skillRoot, 'cached-plugin-skill', {
      description: 'Cached second description',
    });
    expect(buildSkillCatalogXml()).toContain('Cached first description');
    expect(buildSkillCatalogXml()).not.toContain('Cached second description');

    invalidateSkillCache();
    expect(buildSkillCatalogXml()).toContain('Cached second description');
  });
});

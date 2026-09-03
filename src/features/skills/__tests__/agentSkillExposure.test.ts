import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentInvokeRequestSchema } from '../../../app-hosts/linnya/context/agent/schemas';
import { GenericAgentTask } from '../../../app-hosts/linnya/agent-registry/GenericAgentTask';
import defaultAgent from '../../../app-hosts/linnya/agent-registry/agents/default';
import projectPlanningAgent from '../../../app-hosts/linnya/agent-registry/agents/project_planning';
import { createLinnyaFenceInjections } from '../../../app-hosts/linnya/context/agent/createLinnyaFenceInjections';
import {
  appendSkillCatalogSection,
  validatePluginAgentRequiredSkills,
  validateSkillExposureConfig,
} from '../agentSkillExposure';
import { buildSkillCatalogXml, loadSkillContent } from '../catalog';
import { invalidateSkillCache } from '../discovery';
import { ensurePluginSkillAvailabilityRegistered } from '../../../app-hosts/linnya/plugin-registry/skillAvailability';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import {
  clearPluginSkillSourceRootsForTests,
  replacePluginSkillSourceRoots,
} from '../pluginSkillSources';
import type { AgentDefinition } from '../../../app-hosts/linnya/agent-registry/types';
import { PromptKeys } from '@app/schemas';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-agent-skill-'));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeSkillEntry(skillRoot: string, skillName: string): void {
  const skillDir = path.join(skillRoot, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${skillName}`,
      `description: ${skillName} skill`,
      '---',
      '',
      `# ${skillName}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

describe('agent skill exposure', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({
      enabledPluginIds: ['platform', 'skill-fixture-plugin'],
    });
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
    clearPluginSkillSourceRootsForTests();
    invalidateSkillCache();
    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('appends available skill catalog to enabled agent system prompts', () => {
    const task = new GenericAgentTask(defaultAgent);
    const request = AgentInvokeRequestSchema.parse({
      query: 'test',
      promptKey: PromptKeys.DEFAULT,
    });

    const prompt = task.getSystemPromptForRequest(request);

    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('<skill name=');
    expect(prompt).not.toContain('<skills>');
  });

  it('does not append available skill catalog to agents without skill exposure enabled', () => {
    const task = new GenericAgentTask(projectPlanningAgent);
    const request = AgentInvokeRequestSchema.parse({
      query: 'test',
      promptKey: PromptKeys.PROJECT_PLANNING,
    });

    const prompt = task.getSystemPromptForRequest(request);

    expect(prompt).not.toContain('<skills>');
    expect(prompt).not.toContain('<available_skills>');
  });

  it('does not inject skill catalog through additional-context', () => {
    const enabledRequest = AgentInvokeRequestSchema.parse({
      query: 'test',
      promptKey: PromptKeys.DEFAULT,
    });

    expect(createLinnyaFenceInjections(enabledRequest)).toEqual([]);
  });

  it('fails when a prompt embeds available_skills directly', () => {
    expect(() => appendSkillCatalogSection({
      basePrompt: '<available_skills></available_skills>',
      enabled: true,
    })).toThrow('system prompt 已包含 <available_skills>');
  });

  it('filters plugin-owned skills by plugin runtime state', () => {
    const skillRoot = makeTempRoot();
    writeSkillEntry(skillRoot, 'plugin-owned-skill');
    ensurePluginSkillAvailabilityRegistered();
    replacePluginSkillSourceRoots([{ pluginId: 'skill-fixture-plugin', root: skillRoot }]);
    invalidateSkillCache();

    setPluginRuntimeStateForTests({
      installedPluginIds: ['skill-fixture-plugin'],
      enabledPluginIds: [],
    });
    expect(buildSkillCatalogXml()).not.toContain('plugin-owned-skill');
    expect(() => loadSkillContent('plugin-owned-skill')).toThrow(/找不到 Skill "plugin-owned-skill"/);

    setPluginRuntimeStateForTests({
      enabledPluginIds: ['skill-fixture-plugin'],
    });
    expect(buildSkillCatalogXml()).toContain('plugin-owned-skill');
    expect(loadSkillContent('plugin-owned-skill').name).toBe('plugin-owned-skill');

  });

  it('default agent receives enabled plugin skills in the system skill catalog', () => {
    const skillRoot = makeTempRoot();
    writeSkillEntry(skillRoot, 'plugin-owned-skill');
    ensurePluginSkillAvailabilityRegistered();
    replacePluginSkillSourceRoots([{ pluginId: 'skill-fixture-plugin', root: skillRoot }]);
    invalidateSkillCache();
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'skill-fixture-plugin'],
      enabledPluginIds: ['platform', 'skill-fixture-plugin'],
    });

    const request = AgentInvokeRequestSchema.parse({
      query: '使用已启用插件提供的能力',
      promptKey: PromptKeys.DEFAULT,
    });
    const task = new GenericAgentTask(defaultAgent);
    const prompt = task.getSystemPromptForRequest(request);

    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('name="plugin-owned-skill"');
  });

  it('fails validation when skill exposure is enabled without the skill tool', () => {
    const badDefinition: AgentDefinition = {
      id: 'bad-agent',
      promptKey: PromptKeys.PROJECT_PLANNING,
      defaultMode: 'agent',
      description: 'bad agent',
      config: {
        enableTools: true,
        availableTools: ['read_file'],
        skill: {
          enabled: true,
        },
      },
    };

    expect(() => validateSkillExposureConfig([badDefinition])).toThrow(/availableTools .*skill/i);
  });

  it('fails validation when requiredSkills are declared without skill exposure', () => {
    const badDefinition: AgentDefinition = {
      id: 'bad-required-skill-agent',
      promptKey: PromptKeys.PROJECT_PLANNING,
      defaultMode: 'agent',
      description: 'bad agent',
      config: {
        enableTools: true,
        availableTools: ['skill'],
        skill: {
          requiredSkills: ['demo-skill'],
        },
      },
    };

    expect(() => validateSkillExposureConfig([badDefinition])).toThrow(/requiredSkills.*skill\.enabled/i);
  });

  it('allows definitions without skill exposure or with the skill tool configured', () => {
    const definitions: AgentDefinition[] = [
      {
        id: 'disabled-agent',
        promptKey: PromptKeys.PROJECT_PLANNING,
        defaultMode: 'agent',
        description: 'disabled',
        config: {
          enableTools: true,
          availableTools: ['read_file'],
        },
      },
      {
        id: 'enabled-agent',
        promptKey: PromptKeys.DEFAULT,
        defaultMode: 'agent',
        description: 'enabled',
        config: {
          enableTools: true,
          availableTools: ['read_file', 'skill'],
          skill: {
            enabled: true,
          },
        },
      },
    ];

    expect(() => validateSkillExposureConfig(definitions)).not.toThrow();
  });

  it('validates that plugin agent requiredSkills exist in plugin skill roots', () => {
    const tempRoot = makeTempRoot();
    const skillRoot = path.join(tempRoot, 'resources', 'skills');
    writeSkillEntry(skillRoot, 'demo-skill');
    const definitions: AgentDefinition[] = [{
      id: 'demo-agent',
      promptKey: PromptKeys.DEFAULT,
      defaultMode: 'agent',
      description: 'demo',
      config: {
        enableTools: true,
        availableTools: ['skill'],
        skill: {
          enabled: true,
          requiredSkills: ['demo-skill'],
        },
      },
    }];

    expect(() => validatePluginAgentRequiredSkills({
      pluginId: 'demo-plugin',
      definitions,
      skillSourceRoots: [{ pluginId: 'demo-plugin', root: skillRoot }],
    })).not.toThrow();
  });

  it('fails when a plugin agent declares a missing requiredSkill', () => {
    const tempRoot = makeTempRoot();
    const skillRoot = path.join(tempRoot, 'resources', 'skills');
    const definitions: AgentDefinition[] = [{
      id: 'demo-agent',
      promptKey: PromptKeys.DEFAULT,
      defaultMode: 'agent',
      description: 'demo',
      config: {
        enableTools: true,
        availableTools: ['skill'],
        skill: {
          enabled: true,
          requiredSkills: ['missing-skill'],
        },
      },
    }];

    expect(() => validatePluginAgentRequiredSkills({
      pluginId: 'demo-plugin',
      definitions,
      skillSourceRoots: [{ pluginId: 'demo-plugin', root: skillRoot }],
    })).toThrow(/missing-skill/);
  });

});

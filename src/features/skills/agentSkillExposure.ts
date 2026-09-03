/**
 * @file src/features/skills/agentSkillExposure.ts
 * @description Agent 级 Skill 暴露配置的公共辅助
 */

import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import fs from 'node:fs';
import path from 'node:path';
import { parseSkillFile } from './frontmatter';
import { buildSkillCatalogXml } from './catalog';

export function isSkillExposureEnabled(definition: AgentDefinition | undefined): boolean {
  return definition?.config?.skill?.enabled === true;
}

export function appendSkillCatalogSection(params: {
  basePrompt: string;
  enabled: boolean;
}): string {
  const { basePrompt, enabled } = params;
  const trimmed = basePrompt.trim();
  if (!enabled) {
    return trimmed;
  }

  if (trimmed.includes('<available_skills>')) {
    throw new Error(
      '[AgentSkillExposure] system prompt 已包含 <available_skills>。' +
      'Skill catalog 必须由 GenericAgentTask 统一追加，避免重复或位置不一致。'
    );
  }

  const catalog = buildSkillCatalogXml();
  if (!catalog) {
    return trimmed;
  }

  return trimmed.length > 0 ? `${trimmed}\n\n${catalog}` : catalog;
}

export function validateSkillExposureConfig(definitions: readonly AgentDefinition[]): void {
  for (const definition of definitions) {
    const requiredSkills = definition.config?.skill?.requiredSkills ?? [];
    if (!isSkillExposureEnabled(definition) && requiredSkills.length === 0) {
      continue;
    }

    const availableTools = definition.config?.availableTools ?? [];
    const hasSkillTool = availableTools.includes('skill');
    if (!isSkillExposureEnabled(definition)) {
      throw new Error(
        `[AgentSkillExposure] agent "${definition.promptKey}" 声明了 requiredSkills，` +
        `但未开启 config.skill.enabled。请开启 Skill 暴露，或移除 requiredSkills。`
      );
    }
    if (hasSkillTool) {
      continue;
    }

    throw new Error(
      `[AgentSkillExposure] agent "${definition.promptKey}" 开启了 config.skill.enabled，但 availableTools 未包含 "skill"。` +
      ` 请为该 agent 配置 skill 工具，或关闭 config.skill.enabled。`
    );
  }
}

export interface AgentRequiredSkillSourceRoot {
  readonly pluginId: string;
  readonly root: string;
}

export interface AgentRequiredSkillValidationInput {
  readonly pluginId: string;
  readonly definitions: readonly AgentDefinition[];
  readonly skillSourceRoots: readonly AgentRequiredSkillSourceRoot[];
}

function listSkillNamesInRoot(root: string): readonly string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const skillNames: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillFilePath = path.join(root, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFilePath)) {
      continue;
    }

    const raw = fs.readFileSync(skillFilePath, 'utf8');
    const parsed = parseSkillFile(raw, skillFilePath, entry.name);
    if (parsed) {
      skillNames.push(parsed.frontmatter.name);
    }
  }
  return skillNames;
}

export function validatePluginAgentRequiredSkills(params: AgentRequiredSkillValidationInput): void {
  const requiredSkills = new Set<string>();
  for (const definition of params.definitions) {
    for (const skillName of definition.config?.skill?.requiredSkills ?? []) {
      requiredSkills.add(skillName);
    }
  }

  if (requiredSkills.size === 0) {
    return;
  }

  const availableSkills = new Set<string>();
  for (const source of params.skillSourceRoots.filter((root) => root.pluginId === params.pluginId)) {
    for (const skillName of listSkillNamesInRoot(source.root)) {
      availableSkills.add(skillName);
    }
  }

  const missing = [...requiredSkills].filter((skillName) => !availableSkills.has(skillName));
  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `[AgentSkillExposure] 插件 "${params.pluginId}" 的 agent 声明了 requiredSkills，但随包 Skill 资源不存在: `
    + `${missing.join(', ')}`
  );
}

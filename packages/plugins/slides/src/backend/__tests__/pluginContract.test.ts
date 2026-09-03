import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import slidesManifestJson from '../../../plugin.json';
import slidesPackageJson from '../../../package.json';
import { parsePluginManifest } from '@app/schemas';
import {
  SLIDES_DOCUMENT_TYPE,
  SLIDES_FILE_EXTENSION,
  SLIDES_OWNED_TABLES,
  SLIDES_PLUGIN_META,
} from '@plugin/slides/shared';
import { validatePluginAgentRequiredSkills } from 'src/features/skills/agentSkillExposure';
import { toHostAgentDefinition } from 'src/app-hosts/linnya/plugin-registry/registry';
import { slidesBackendPlugin } from '../index';
import { slidesToolManifest } from '../toolManifest';

type NamedToolConstructor = new () => { readonly name: string };

const packageRoot = path.resolve(import.meta.dirname, '../../..');
const skillRoot = path.join(packageRoot, 'resources/skills');

const RETIRED_EDIT_TOOL_NAMES = [
  'ppt_edit_text',
  'ppt_edit_data',
  'ppt_edit_image',
  'ppt_edit_style',
  'ppt_edit_geometry',
  'ppt_edit_arrangement',
  'ppt_align_elements',
  'ppt_delete_element',
  'ppt_manage_slides',
] as const;

function instantiateToolNames(toolClasses: readonly NamedToolConstructor[] | undefined): readonly string[] {
  return (toolClasses ?? []).map(ToolClass => new ToolClass().name);
}

function listMigrationManifestEntries(
  migrations: readonly { readonly version: number; readonly description: string }[],
): Array<{ version: number; description: string }> {
  return migrations.map(({ version, description }) => ({ version, description }));
}

function listSkillResourceNames(): readonly string[] {
  return fs.readdirSync(skillRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

describe('Slides backend contribution contract', () => {
  it('keeps package metadata, manifest and backend contribution aligned', () => {
    const manifest = parsePluginManifest(slidesManifestJson);

    expect(slidesPackageJson.version).toBe(manifest.version);
    expect(SLIDES_PLUGIN_META.version).toBe(manifest.version);
    expect(manifest.ownedFileTypes).toEqual([
      expect.objectContaining({
        nodeType: SLIDES_DOCUMENT_TYPE,
        extension: SLIDES_FILE_EXTENSION,
      }),
    ]);
    expect(SLIDES_OWNED_TABLES).toEqual(manifest.ownedTables);
    expect(slidesBackendPlugin.ownedTables).toEqual(manifest.ownedTables);
    expect(manifest.migrations).toEqual(
      listMigrationManifestEntries(slidesBackendPlugin.pluginMigrations ?? []),
    );
  });

  it('keeps registered tools, decorators and agent tool references aligned', () => {
    const registeredToolNames = [...instantiateToolNames(slidesBackendPlugin.toolClasses)].sort();
    const manifestToolNames = [...slidesToolManifest.allNames].sort();
    const decoratorToolNames = (slidesBackendPlugin.toolContextDecorators ?? [])
      .flatMap(decorator => [...decorator.toolNames])
      .sort();

    expect(manifestToolNames).toEqual(registeredToolNames);
    expect(decoratorToolNames).toEqual(registeredToolNames);
    for (const decorator of slidesBackendPlugin.toolContextDecorators ?? []) {
      expect(decorator.copyBinding).toBeUndefined();
    }

    const registeredToolNameSet = new Set(registeredToolNames);
    for (const toolName of Object.values(slidesToolManifest.agentTools ?? {}).flat()) {
      if (slidesToolManifest.allNames.includes(toolName)) {
        expect(registeredToolNameSet.has(toolName)).toBe(true);
      }
    }
  });

  it('keeps retired family edit tools outside manifest and runtime registration', () => {
    const registeredToolNames = new Set(instantiateToolNames(slidesBackendPlugin.toolClasses));
    const manifestToolNames = new Set(slidesToolManifest.allNames);

    expect(slidesToolManifest.legacyEditNames).toBeUndefined();
    for (const toolName of RETIRED_EDIT_TOOL_NAMES) {
      expect(registeredToolNames.has(toolName)).toBe(false);
      expect(manifestToolNames.has(toolName)).toBe(false);
    }
  });

  it('keeps agent required skills and store manifest backed by package resources', () => {
    const manifest = parsePluginManifest(slidesManifestJson);
    const definitions = (slidesBackendPlugin.agentDefinitions ?? [])
      .map(definition => toHostAgentDefinition(slidesBackendPlugin.meta.id, definition));

    expect(() => validatePluginAgentRequiredSkills({
      pluginId: slidesBackendPlugin.meta.id,
      definitions,
      skillSourceRoots: [{ pluginId: slidesBackendPlugin.meta.id, root: skillRoot }],
    })).not.toThrow();
    expect((manifest.skills ?? []).map(skill => skill.name).sort()).toEqual(listSkillResourceNames());
    expect(manifest.details.length).toBeGreaterThan(0);
    expect(manifest.releaseNotes?.length ?? 0).toBeGreaterThan(0);
    expect(manifest.agents?.length ?? 0).toBeGreaterThan(0);
  });
});

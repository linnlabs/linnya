import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from './configLoader';
import { loadDotEnv } from './env';
import { resolveConfiguredInference } from '../quickstart';

export interface DoctorCommandOptions {
  cwd: string;
  configPath: string;
}

export interface DoctorReport {
  ok: boolean;
  lines: string[];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isNode20OrNewer(version: string): boolean {
  const major = Number(version.split('.')[0]);
  return Number.isFinite(major) && major >= 20;
}

async function hasLegacyGitHubPackagesRegistry(cwd: string): Promise<boolean> {
  const npmrc = resolve(cwd, '.npmrc');
  if (!(await pathExists(npmrc))) return false;
  const content = await readFile(npmrc, 'utf8');
  return content.includes('@linnlabs:registry=https://npm.pkg.github.com/');
}

function pass(label: string): string {
  return `✓ ${label}`;
}

function fail(label: string, reason: string): string {
  return `✗ ${label}: ${reason}`;
}

function warn(label: string, reason: string): string {
  return `! ${label}: ${reason}`;
}

export async function runDoctorCommand(options: DoctorCommandOptions): Promise<DoctorReport> {
  await loadDotEnv(options.cwd);

  const lines: string[] = [];
  let ok = true;

  if (isNode20OrNewer(process.versions.node)) {
    lines.push(pass(`Node ${process.versions.node}`));
  } else {
    ok = false;
    lines.push(fail('Node version', `requires >= 20, current ${process.versions.node}`));
  }

  if (await hasLegacyGitHubPackagesRegistry(options.cwd)) {
    lines.push(warn('.npmrc legacy GitHub Packages registry', 'remove the @linnlabs registry override; linnkit is published on npmjs.com'));
  } else {
    lines.push(pass('npmjs public registry'));
  }

  if (process.env.OPENAI_API_KEY) {
    lines.push(pass('OPENAI_API_KEY'));
  } else {
    ok = false;
    lines.push(fail('OPENAI_API_KEY', 'set it in .env or export it before running a real provider'));
  }

  try {
    const config = await loadConfig(options.configPath, options.cwd);
    lines.push(pass(`config ${options.configPath}`));
    lines.push(pass(`agents: ${config.agents.map((agent) => agent.spec.id).join(', ')}`));

    await resolveConfiguredInference(config);
    lines.push(pass('canonical inference port'));
  } catch (error) {
    ok = false;
    lines.push(fail('config', error instanceof Error ? error.message : String(error)));
  }

  return { ok, lines };
}

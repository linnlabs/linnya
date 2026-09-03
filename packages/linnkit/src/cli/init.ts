import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createQuickstartTemplateFiles } from './templates';

export interface InitCommandOptions {
  cwd: string;
  name: string;
}

async function isDirectoryEmpty(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch {
    return true;
  }
}

export async function runInitCommand(options: InitCommandOptions): Promise<string[]> {
  const targetDir = resolve(options.cwd, options.name);
  if (!(await isDirectoryEmpty(targetDir))) {
    throw new Error(`[linnkit] target directory is not empty: ${targetDir}`);
  }

  const written: string[] = [];
  for (const file of createQuickstartTemplateFiles(options.name)) {
    const filePath = join(targetDir, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, 'utf8');
    written.push(file.path);
  }
  return written;
}

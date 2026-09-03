import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundles = {
  main: path.join(repositoryRoot, 'dist/main/main.cjs'),
  utility: path.join(repositoryRoot, 'dist/main/sandbox/sandboxUtilityProcess.cjs'),
  evaluator: path.join(repositoryRoot, 'dist/main/sandbox/sandboxEvaluatorProcess.cjs'),
};
const legacyRunnerPath = path.join(
  repositoryRoot,
  'dist/main/sandbox/sandboxRunnerProcess.cjs',
);
const markers = {
  utilityEntrypoint: {
    text: 'sandbox utility process requires process.parentPort',
    owner: 'utility',
  },
  windowsOwnerLoader: {
    text: 'Windows local process runtime manifest is unavailable',
    owner: 'utility',
  },
  evaluatorEntrypoint: {
    text: 'sandbox.evaluator.invalid_request',
    owner: 'evaluator',
  },
};
const removedInternalMainMarker = '--linnya-internal-sandbox-runner';

const contents = Object.fromEntries(await Promise.all(
  Object.entries(bundles).map(async ([name, filePath]) => {
    try {
      return [name, await readFile(filePath, 'utf8')];
    } catch (error) {
      throw new Error(`Sandbox bundle boundary requires ${filePath}`, { cause: error });
    }
  }),
));

function count(text, marker) {
  return text.split(marker).length - 1;
}

const failures = [];
try {
  await readFile(legacyRunnerPath);
  failures.push(`旧 Sandbox runner bundle 必须不存在：${legacyRunnerPath}`);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
    throw new Error(`无法确认旧 Sandbox runner bundle 已删除：${legacyRunnerPath}`, {
      cause: error,
    });
  }
}

for (const [markerName, marker] of Object.entries(markers)) {
  const ownerCount = count(contents[marker.owner], marker.text);
  if (ownerCount !== 1) {
    failures.push(`${marker.owner} 中 ${markerName} 应恰好一份，实际 ${ownerCount} 份`);
  }
  for (const bundleName of Object.keys(contents).filter(name => name !== marker.owner)) {
    const forbiddenCount = count(contents[bundleName], marker.text);
    if (forbiddenCount !== 0) {
      failures.push(`${bundleName} 不得包含 child-only ${markerName}，实际 ${forbiddenCount} 份`);
    }
  }
}

for (const [bundleName, content] of Object.entries(contents)) {
  const legacyMarkerCount = count(content, removedInternalMainMarker);
  if (legacyMarkerCount !== 0) {
    failures.push(`${bundleName} 不得包含已删除的 internal Main marker`);
  }
}

if (failures.length > 0) {
  process.stderr.write('[sandbox-utility-bundle-boundary-guard] 边界失败：\n');
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    '[sandbox-utility-bundle-boundary-guard] 旧 runner/internal Main 不存在，Main、Utility、Evaluator bundle 边界唯一。\n',
  );
}

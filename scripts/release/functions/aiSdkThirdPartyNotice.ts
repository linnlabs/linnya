import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  AiSdkReleasePackage,
  AiSdkThirdPartyNoticeProblem,
} from '../definitions/aiSdkThirdPartyNotice';
import {
  CRAFT_AGENTS_OAUTH_NOTICE,
  MODELS_DEV_CATALOG_NOTICE,
} from '../definitions/sourceDependencyBom';

export const AI_SDK_NOTICE_FILE_NAME = 'THIRD_PARTY_NOTICES.txt';

const EXTERNAL_AI_SDK_PROVIDER_SOURCES = {
  '@openrouter/ai-sdk-provider': {
    upstream: 'openrouter',
    license: 'Apache-2.0',
    source: 'https://github.com/OpenRouterTeam/ai-sdk-provider',
    title: 'OpenRouter AI SDK Provider',
  },
  'ai-sdk-ollama': {
    upstream: 'ollama-provider',
    license: 'MIT',
    source: 'https://github.com/jagreehal/ai-sdk-ollama',
    title: 'Ollama AI SDK Provider',
  },
} as const;

type ExternalProviderPackageName = keyof typeof EXTERNAL_AI_SDK_PROVIDER_SOURCES;

function isExternalProviderPackage(name: string): name is ExternalProviderPackageName {
  return name in EXTERNAL_AI_SDK_PROVIDER_SOURCES;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!isRecord(value)) throw new Error(`JSON 顶层必须是对象：${filePath}`);
  return value;
}

function readString(record: Record<string, unknown>, key: string, filePath: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`${filePath} 缺少字符串字段 ${key}`);
  }
  return value;
}

function resolveInstalledPackagePath(
  rootDir: string,
  packageName: string,
  fileName: string
): string {
  const installationRoots = [rootDir, path.join(rootDir, 'packages/linnkit-provider-ai-sdk')];
  for (const installationRoot of installationRoots) {
    const candidate = path.join(installationRoot, 'node_modules', packageName, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${packageName} 未安装在应用或 adapter package 的 node_modules`);
}

export function readAiSdkReleasePackages(rootDir: string): readonly AiSdkReleasePackage[] {
  const manifestPaths = [
    path.join(rootDir, 'package.json'),
    path.join(rootDir, 'packages/linnkit-provider-ai-sdk/package.json'),
  ];
  const declaredVersions = new Map<string, string>();
  for (const manifestPath of manifestPaths) {
    const manifest = readJsonRecord(manifestPath);
    const dependencies = manifest.dependencies;
    if (!isRecord(dependencies)) throw new Error(`${manifestPath} 缺少 dependencies 对象`);
    for (const [name, version] of Object.entries(dependencies)) {
      if (name !== 'ai' && !name.startsWith('@ai-sdk/') && !isExternalProviderPackage(name)) {
        continue;
      }
      if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`${name} 必须在 dependencies 使用精确 semver，当前为 ${String(version)}`);
      }
      const existing = declaredVersions.get(name);
      if (existing !== undefined && existing !== version) {
        throw new Error(
          `${name} 在应用与 adapter package 中声明了冲突版本：${existing} / ${version}`
        );
      }
      declaredVersions.set(name, version);
    }
  }

  // 发行集合由根应用的非 Language 能力和 adapter package 的 Language 依赖共同组成。
  // Provider factory 搬入 package 后，不能再要求根应用复制一份直接依赖清单。
  const packageNames = [...declaredVersions.keys()].sort();
  if (packageNames.length === 0) {
    throw new Error('应用与 adapter package 均未声明 AI SDK 生产依赖');
  }

  return packageNames.map(name => {
    const declaredVersion = declaredVersions.get(name);
    if (declaredVersion === undefined) throw new Error(`${name} 缺少已解析版本`);
    const installedManifestPath = resolveInstalledPackagePath(rootDir, name, 'package.json');
    const installedManifest = readJsonRecord(installedManifestPath);
    const installedVersion = readString(installedManifest, 'version', installedManifestPath);
    if (installedVersion !== declaredVersion) {
      throw new Error(`${name} 声明版本 ${declaredVersion} 与安装版本 ${installedVersion} 不一致`);
    }
    const externalSource = isExternalProviderPackage(name)
      ? EXTERNAL_AI_SDK_PROVIDER_SOURCES[name]
      : undefined;
    const expectedLicense = externalSource?.license ?? 'Apache-2.0';
    const license = readString(installedManifest, 'license', installedManifestPath);
    if (license !== expectedLicense) {
      throw new Error(
        `${name}@${installedVersion} license 不是预期的 ${expectedLicense}：${license}`
      );
    }
    const licensePath = resolveInstalledPackagePath(rootDir, name, 'LICENSE');
    if (!fs.statSync(licensePath).isFile())
      throw new Error(`${name}@${installedVersion} 缺少 LICENSE 文件`);
    return {
      name,
      version: installedVersion,
      license: expectedLicense,
      upstream: externalSource?.upstream ?? 'vercel-ai',
    };
  });
}

export function createAiSdkThirdPartyNotice(rootDir: string): string {
  const packages = readAiSdkReleasePackages(rootDir);
  const sharedLicense = fs
    .readFileSync(resolveInstalledPackagePath(rootDir, 'ai', 'LICENSE'), 'utf8')
    .trim();
  for (const packageInfo of packages) {
    const packageLicense = fs
      .readFileSync(resolveInstalledPackagePath(rootDir, packageInfo.name, 'LICENSE'), 'utf8')
      .trim();
    if (packageInfo.upstream === 'vercel-ai' && packageLicense !== sharedLicense) {
      throw new Error(
        `${packageInfo.name}@${packageInfo.version} 的 LICENSE 与 AI SDK Core 不一致`
      );
    }
  }
  const packageLine = (packageInfo: AiSdkReleasePackage) =>
    `- ${packageInfo.name}@${packageInfo.version} — ${packageInfo.license}`;
  const vercelPackageLines = packages
    .filter(packageInfo => packageInfo.upstream === 'vercel-ai')
    .map(packageLine);
  const externalSections = Object.entries(EXTERNAL_AI_SDK_PROVIDER_SOURCES).flatMap(
    ([packageName, source]) => {
      const packageInfo = packages.find(candidate => candidate.name === packageName);
      if (!packageInfo) return [];
      const license = fs
        .readFileSync(resolveInstalledPackagePath(rootDir, packageName, 'LICENSE'), 'utf8')
        .trim();
      return [source.title, `Source: ${source.source}`, packageLine(packageInfo), '', license, ''];
    }
  );
  return [
    'LINNYA THIRD-PARTY NOTICES',
    '',
    'Vercel AI SDK',
    'Source: https://github.com/vercel/ai',
    ...vercelPackageLines,
    '',
    'The Vercel packages above share the following upstream LICENSE text:',
    '',
    sharedLicense,
    '',
    ...externalSections,
    MODELS_DEV_CATALOG_NOTICE.title,
    `Source: ${MODELS_DEV_CATALOG_NOTICE.source}`,
    '',
    MODELS_DEV_CATALOG_NOTICE.content,
    '',
    CRAFT_AGENTS_OAUTH_NOTICE.title,
    `Source: ${CRAFT_AGENTS_OAUTH_NOTICE.source}`,
    `License: ${CRAFT_AGENTS_OAUTH_NOTICE.licenseExpression}`,
    '',
    CRAFT_AGENTS_OAUTH_NOTICE.content,
    '',
  ].join('\n');
}

function hasNoticeExtraResource(rootManifest: Record<string, unknown>): boolean {
  const build = rootManifest.build;
  if (!isRecord(build) || !Array.isArray(build.extraResources)) return false;
  return build.extraResources.some(
    resource =>
      isRecord(resource) &&
      resource.from === AI_SDK_NOTICE_FILE_NAME &&
      resource.to === AI_SDK_NOTICE_FILE_NAME
  );
}

export function validateAiSdkThirdPartyNotice(
  rootDir: string
): readonly AiSdkThirdPartyNoticeProblem[] {
  const problems: AiSdkThirdPartyNoticeProblem[] = [];
  try {
    const packages = readAiSdkReleasePackages(rootDir);
    const noticePath = path.join(rootDir, AI_SDK_NOTICE_FILE_NAME);
    if (!fs.existsSync(noticePath)) {
      problems.push({ path: AI_SDK_NOTICE_FILE_NAME, message: '缺少第三方 NOTICE。' });
    } else {
      const notice = fs.readFileSync(noticePath, 'utf8');
      const missingFragments = [
        ...packages.map(packageInfo => `- ${packageInfo.name}@${packageInfo.version}`),
        'https://github.com/OpenRouterTeam/ai-sdk-provider',
        'https://github.com/jagreehal/ai-sdk-ollama',
        MODELS_DEV_CATALOG_NOTICE.title,
        MODELS_DEV_CATALOG_NOTICE.source,
        'Copyright (c) 2025 models.dev',
        CRAFT_AGENTS_OAUTH_NOTICE.title,
        CRAFT_AGENTS_OAUTH_NOTICE.source,
        'Copyright 2026 Craft Docs Ltd.',
      ].filter(fragment => !notice.includes(fragment));
      if (missingFragments.length > 0) {
        problems.push({
          path: AI_SDK_NOTICE_FILE_NAME,
          message: `NOTICE 缺少当前第三方依赖或移植源码许可证证据：${missingFragments.join(', ')}`,
        });
      }
    }
  } catch (error: unknown) {
    problems.push({
      path: 'package.json',
      message: error instanceof Error ? error.message : 'AI SDK license 校验出现未知错误。',
    });
  }

  const rootManifest = readJsonRecord(path.join(rootDir, 'package.json'));
  if (!hasNoticeExtraResource(rootManifest)) {
    problems.push({
      path: 'package.json#build.extraResources',
      message: `${AI_SDK_NOTICE_FILE_NAME} 未声明为安装包外部资源。`,
    });
  }
  return problems;
}

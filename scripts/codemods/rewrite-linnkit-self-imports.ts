import fs from 'node:fs';
import path from 'node:path';

import {
  type ExportDeclaration,
  Project,
  QuoteKind,
  SyntaxKind,
  type CallExpression,
  type ImportDeclaration,
  type ImportTypeNode,
  type SourceFile,
  type StringLiteral,
  type StringLiteralLike,
} from 'ts-morph';

export interface RewriteLinnkitSelfImportsOptions {
  rootDir: string;
  include?: string[];
  dryRun?: boolean;
  packageSrcDir?: string;
}

export interface UnsupportedLinnkitSelfImport {
  filePath: string;
  importPath: string;
  kind: 'static-import' | 'dynamic-import' | 'import-type';
}

export interface RewriteLinnkitSelfImportsReport {
  filesScanned: number;
  filesChanged: number;
  rewrittenImports: number;
  updatedFiles: string[];
}

const AGENT_ROOT_IMPORT = 'src/agent';
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function defaultIncludePatterns(rootDir: string, packageSrcDir: string): string[] {
  return [
    path.join(rootDir, packageSrcDir, '**/*.ts'),
    path.join(rootDir, packageSrcDir, '**/*.tsx'),
  ];
}

function isAgentSelfImportPath(importPath: string): boolean {
  return importPath === AGENT_ROOT_IMPORT || importPath.startsWith(`${AGENT_ROOT_IMPORT}/`);
}

function resolveDynamicImportLiteral(callExpression: CallExpression): StringLiteral | null {
  if (callExpression.getExpression().getKind() !== SyntaxKind.ImportKeyword) {
    return null;
  }

  const [argument] = callExpression.getArguments();
  if (argument === undefined || !argument.isKind(SyntaxKind.StringLiteral)) {
    return null;
  }

  return argument;
}

function resolveImportTypeLiteral(importTypeNode: ImportTypeNode): StringLiteralLike | null {
  const argument = importTypeNode.getArgument();
  if (!argument.isKind(SyntaxKind.LiteralType)) {
    return null;
  }

  const literal = argument.getLiteral();
  return literal.isKind(SyntaxKind.StringLiteral) || literal.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)
    ? literal
    : null;
}

function resolveAgentImportTarget(importPath: string, packageSrcRoot: string): string | null {
  const normalizedRoot = normalizePath(packageSrcRoot);
  if (importPath === AGENT_ROOT_IMPORT || importPath === `${AGENT_ROOT_IMPORT}/index`) {
    const rootIndex = path.join(normalizedRoot, 'index.ts');
    return fs.existsSync(rootIndex) ? rootIndex : null;
  }

  const suffix = importPath.slice(`${AGENT_ROOT_IMPORT}/`.length);
  const basePath = path.join(normalizedRoot, suffix);
  const directMatch = SOURCE_EXTENSIONS
    .map((extension) => `${basePath}${extension}`)
    .find((candidate) => fs.existsSync(candidate));
  if (directMatch !== undefined) {
    return directMatch;
  }

  const indexMatch = SOURCE_EXTENSIONS
    .map((extension) => path.join(basePath, `index${extension}`))
    .find((candidate) => fs.existsSync(candidate));
  return indexMatch ?? null;
}

function toRelativeModuleSpecifier(sourceFilePath: string, targetFilePath: string): string {
  const sourceDir = path.dirname(sourceFilePath);
  const targetWithoutExtension = targetFilePath.replace(/\.(ts|tsx|mts|cts)$/u, '');
  let relative = normalizePath(path.relative(sourceDir, targetWithoutExtension));
  if (relative.endsWith('/index')) {
    relative = relative.slice(0, -'/index'.length);
  }

  if (relative === '') {
    return './index';
  }

  if (!relative.startsWith('.')) {
    return `./${relative}`;
  }

  return relative;
}

function formatUnsupportedImportMessage(unsupported: UnsupportedLinnkitSelfImport[]): string {
  const header =
    'rewrite-linnkit-self-imports found unresolved src/agent self-imports inside packages/linnkit/src. '
    + 'Move these files or fix the import target before rerunning the codemod.';
  const lines = unsupported
    .slice()
    .sort((left, right) =>
      left.filePath === right.filePath
        ? left.importPath.localeCompare(right.importPath)
        : left.filePath.localeCompare(right.filePath),
    )
    .map((entry) => `- [${entry.kind}] ${entry.filePath}: ${entry.importPath}`);
  return [header, ...lines].join('\n');
}

function rewriteStaticImport(params: {
  declaration: ImportDeclaration;
  unsupported: UnsupportedLinnkitSelfImport[];
  rootDir: string;
  packageSrcRoot: string;
}): boolean {
  const importPath = params.declaration.getModuleSpecifierValue();
  if (!isAgentSelfImportPath(importPath)) {
    return false;
  }

  const targetFilePath = resolveAgentImportTarget(importPath, params.packageSrcRoot);
  if (targetFilePath === null) {
    params.unsupported.push({
      filePath: normalizePath(path.relative(params.rootDir, params.declaration.getSourceFile().getFilePath())),
      importPath,
      kind: 'static-import',
    });
    return false;
  }

  const rewritten = toRelativeModuleSpecifier(
    params.declaration.getSourceFile().getFilePath(),
    targetFilePath,
  );
  if (rewritten === importPath) {
    return false;
  }

  params.declaration.setModuleSpecifier(rewritten);
  return true;
}

function rewriteExportDeclaration(params: {
  declaration: ExportDeclaration;
  unsupported: UnsupportedLinnkitSelfImport[];
  rootDir: string;
  packageSrcRoot: string;
}): boolean {
  const importPath = params.declaration.getModuleSpecifierValue();
  if (importPath === undefined || !isAgentSelfImportPath(importPath)) {
    return false;
  }

  const targetFilePath = resolveAgentImportTarget(importPath, params.packageSrcRoot);
  if (targetFilePath === null) {
    params.unsupported.push({
      filePath: normalizePath(path.relative(params.rootDir, params.declaration.getSourceFile().getFilePath())),
      importPath,
      kind: 'static-import',
    });
    return false;
  }

  params.declaration.setModuleSpecifier(
    toRelativeModuleSpecifier(params.declaration.getSourceFile().getFilePath(), targetFilePath),
  );
  return true;
}

function rewriteDynamicImport(params: {
  literal: StringLiteral;
  sourceFile: SourceFile;
  unsupported: UnsupportedLinnkitSelfImport[];
  rootDir: string;
  packageSrcRoot: string;
}): boolean {
  const importPath = params.literal.getLiteralValue();
  if (!isAgentSelfImportPath(importPath)) {
    return false;
  }

  const targetFilePath = resolveAgentImportTarget(importPath, params.packageSrcRoot);
  if (targetFilePath === null) {
    params.unsupported.push({
      filePath: normalizePath(path.relative(params.rootDir, params.sourceFile.getFilePath())),
      importPath,
      kind: 'dynamic-import',
    });
    return false;
  }

  params.literal.setLiteralValue(
    toRelativeModuleSpecifier(params.sourceFile.getFilePath(), targetFilePath),
  );
  return true;
}

function rewriteImportType(params: {
  importTypeNode: ImportTypeNode;
  sourceFile: SourceFile;
  unsupported: UnsupportedLinnkitSelfImport[];
  rootDir: string;
  packageSrcRoot: string;
}): boolean {
  const literal = resolveImportTypeLiteral(params.importTypeNode);
  if (literal === null) {
    return false;
  }

  const importPath = literal.getLiteralText();
  if (!isAgentSelfImportPath(importPath)) {
    return false;
  }

  const targetFilePath = resolveAgentImportTarget(importPath, params.packageSrcRoot);
  if (targetFilePath === null) {
    params.unsupported.push({
      filePath: normalizePath(path.relative(params.rootDir, params.sourceFile.getFilePath())),
      importPath,
      kind: 'import-type',
    });
    return false;
  }

  literal.setLiteralValue(
    toRelativeModuleSpecifier(params.sourceFile.getFilePath(), targetFilePath),
  );
  return true;
}

export async function runRewriteLinnkitSelfImportsCodemod(
  options: RewriteLinnkitSelfImportsOptions,
): Promise<RewriteLinnkitSelfImportsReport> {
  const packageSrcDir = options.packageSrcDir ?? 'packages/linnkit/src';
  const packageSrcRoot = path.join(options.rootDir, packageSrcDir);
  const include = options.include?.map((pattern) => path.join(options.rootDir, pattern))
    ?? defaultIncludePatterns(options.rootDir, packageSrcDir);

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: {
      quoteKind: QuoteKind.Single,
      useTrailingCommas: true,
    },
  });
  project.addSourceFilesAtPaths(include);

  const updatedFiles = new Set<string>();
  const unsupported: UnsupportedLinnkitSelfImport[] = [];
  let rewrittenImports = 0;

  for (const sourceFile of project.getSourceFiles()) {
    let fileTouched = false;

    for (const declaration of sourceFile.getImportDeclarations()) {
      const rewritten = rewriteStaticImport({
        declaration,
        unsupported,
        rootDir: options.rootDir,
        packageSrcRoot,
      });
      if (rewritten) {
        rewrittenImports += 1;
        fileTouched = true;
      }
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
      const rewritten = rewriteExportDeclaration({
        declaration,
        unsupported,
        rootDir: options.rootDir,
        packageSrcRoot,
      });
      if (rewritten) {
        rewrittenImports += 1;
        fileTouched = true;
      }
    }

    for (const callExpression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const literal = resolveDynamicImportLiteral(callExpression);
      if (literal === null) {
        continue;
      }

      const rewritten = rewriteDynamicImport({
        literal,
        sourceFile,
        unsupported,
        rootDir: options.rootDir,
        packageSrcRoot,
      });
      if (rewritten) {
        rewrittenImports += 1;
        fileTouched = true;
      }
    }

    for (const importTypeNode of sourceFile.getDescendantsOfKind(SyntaxKind.ImportType)) {
      const rewritten = rewriteImportType({
        importTypeNode,
        sourceFile,
        unsupported,
        rootDir: options.rootDir,
        packageSrcRoot,
      });
      if (rewritten) {
        rewrittenImports += 1;
        fileTouched = true;
      }
    }

    if (fileTouched) {
      updatedFiles.add(normalizePath(path.relative(options.rootDir, sourceFile.getFilePath())));
    }
  }

  if (unsupported.length > 0) {
    throw new Error(formatUnsupportedImportMessage(unsupported));
  }

  if (!options.dryRun) {
    await project.save();
  }

  return {
    filesScanned: project.getSourceFiles().length,
    filesChanged: updatedFiles.size,
    rewrittenImports,
    updatedFiles: [...updatedFiles].sort(),
  };
}

function readCliArg(args: string[], prefix: string): string | undefined {
  const match = args.find((arg) => arg.startsWith(prefix));
  if (!match) {
    return undefined;
  }
  return match.slice(prefix.length);
}

function parseCliOptions(args: string[]): RewriteLinnkitSelfImportsOptions {
  const rootDir = readCliArg(args, '--rootDir=');
  if (!rootDir) {
    throw new Error('Missing required --rootDir=/absolute/path');
  }

  const includeArg = readCliArg(args, '--include=');
  const packageSrcDir = readCliArg(args, '--packageSrcDir=');
  return {
    rootDir: path.resolve(rootDir),
    include: includeArg?.split(',').filter((value) => value.length > 0),
    dryRun: args.includes('--dry-run'),
    packageSrcDir,
  };
}

async function runCli(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const report = await runRewriteLinnkitSelfImportsCodemod(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isDirectExecution =
  typeof process.argv[1] === 'string'
  && normalizePath(process.argv[1]).endsWith('scripts/codemods/rewrite-linnkit-self-imports.ts');

if (isDirectExecution) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

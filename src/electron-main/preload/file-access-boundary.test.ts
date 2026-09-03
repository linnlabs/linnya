import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const systemPreloadPath = path.resolve(
  process.cwd(),
  'src/electron-main/preload/modules/system-preload.ts',
);
const mediaUrlPreloadPath = path.resolve(
  process.cwd(),
  'src/electron-main/preload/modules/media-url.ts',
);

// 过渡红线：FileAccessService 落地前，preload 里所有裸路径能力都必须在这里显式登记。
const APPROVED_BARE_PATH_CHANNELS = [
  'export-files-to-directory',
  'load-audio-file-as-data-url',
  'load-image-as-data-url',
  'get-file-size',
  'show-item-in-folder',
  'stat-image-file',
] as const;

function isPathLikeParameterName(name: string): boolean {
  return name.toLowerCase().includes('path');
}

function isPathLikeParameterType(parameter: ts.ParameterDeclaration, sourceFile: ts.SourceFile): boolean {
  return parameter.type ? parameter.type.getText(sourceFile).toLowerCase().includes('path') : false;
}

function collectPathBoundaryParameters(
  node: ts.ArrowFunction | ts.FunctionExpression,
  sourceFile: ts.SourceFile,
): Set<string> {
  const parameterNames = new Set<string>();

  for (const parameter of node.parameters) {
    if (
      ts.isIdentifier(parameter.name) &&
      (isPathLikeParameterName(parameter.name.text) || isPathLikeParameterType(parameter, sourceFile))
    ) {
      parameterNames.add(parameter.name.text);
    }
  }

  return parameterNames;
}

function isIpcInvokeCall(node: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'ipcRenderer' &&
    node.expression.name.text === 'invoke'
  );
}

function callUsesPathParameter(node: ts.CallExpression, pathParameterNames: Set<string>): boolean {
  return node.arguments
    .slice(1)
    .some((argument) => ts.isIdentifier(argument) && pathParameterNames.has(argument.text));
}

function collectInvokedChannelsUsingPathParameters(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    systemPreloadPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const channels = new Set<string>();

  function visitFunction(node: ts.ArrowFunction | ts.FunctionExpression): void {
    const pathParameterNames = collectPathBoundaryParameters(node, sourceFile);
    if (pathParameterNames.size === 0) {
      return;
    }

    function visitCall(candidate: ts.Node): void {
      if (
        ts.isCallExpression(candidate) &&
        isIpcInvokeCall(candidate) &&
        candidate.arguments.length >= 2 &&
        ts.isStringLiteral(candidate.arguments[0]) &&
        callUsesPathParameter(candidate, pathParameterNames)
      ) {
        channels.add(candidate.arguments[0].text);
      }

      ts.forEachChild(candidate, visitCall);
    }

    visitCall(node.body);
  }

  function visit(node: ts.Node): void {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      visitFunction(node);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...channels].sort();
}

describe('preload file access boundary', () => {
  it('requires every bare path preload invoke to stay on the audited R1 channel list', () => {
    const source = readFileSync(systemPreloadPath, 'utf8');

    expect(collectInvokedChannelsUsingPathParameters(source)).toEqual(
      [...APPROVED_BARE_PATH_CHANNELS].sort(),
    );
  });

  it('keeps media:// URL construction inside the audited preload builder', () => {
    const source = readFileSync(mediaUrlPreloadPath, 'utf8');

    expect(source).toContain("const mediaLoadPrefix = 'media://load'");
    expect(source).toContain('new TextEncoder().encode(filePath)');
    expect(source).toContain('btoa(binary)');
    expect(source).not.toContain('node:path');
    expect(source).not.toContain('Buffer.from');
    expect(source).toContain('buildImageUrl');
    expect(source).toContain('buildGeneratedImageUrl');
    expect(source).toContain('buildAudioUrl');
  });
});

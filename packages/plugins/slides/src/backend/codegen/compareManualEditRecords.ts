import { getSlidesTypeScriptRuntime } from '../capabilities/typescriptRuntime/index.js';
import type ts from 'typescript';
import type { ParseCodegenDiagnostic } from './writeDiagnostics/definitions/codegenDiagnostic.js';

/** 候选源码看不到被删掉的记录，必须在修订提交前与原源码比较。 */
export function compareManualEditRecords(before: string, after: string): ParseCodegenDiagnostic[] {
  const previous = readTargetKeys(before), next = readTargetKeys(after);
  if (!previous || !next) return [];
  return [...previous].filter(key => !next.has(key)).map(key => ({
    phase: 'parse', severity: 'warning', code: 'manual_edit_removed', path: `manualEdits.${key}`,
    message: `本次源码移除了人工修改 ${key}。如非有意清理，请从源码历史恢复该记录。`,
    hint: '删除生成对象不需要删除人工记录；失联记录会停用并保留。',
  }));
}

function readTargetKeys(source: string): Set<string> | null {
  const t = getSlidesTypeScriptRuntime();
  const sf = t.createSourceFile('deck.js', source, t.ScriptTarget.Latest, true, t.ScriptKind.JS);
  const result = new Set<string>();
  let valid = true;
  function property(node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
    const entry = node.properties.find(p => t.isPropertyAssignment(p) && p.name.getText(sf).replace(/["']/g, '') === name);
    return entry && t.isPropertyAssignment(entry) ? entry.initializer : undefined;
  }
  function visit(node: ts.Node): void {
    if (t.isCallExpression(node) && t.isIdentifier(node.expression) && node.expression.text === 'compose') {
      const config = node.arguments[0];
      if (!config || !t.isObjectLiteralExpression(config)) { valid = false; return; }
      const edits = property(config, 'manualEdits');
      if (!edits) return;
      if (!t.isObjectLiteralExpression(edits)) { valid = false; return; }
      const slides = property(edits, 'slides');
      if (!slides || !t.isArrayLiteralExpression(slides)) { valid = false; return; }
      for (const slide of slides.elements) {
        if (!t.isObjectLiteralExpression(slide)) { valid = false; continue; }
        const slideKey = property(slide, 'slideKey');
        if (!slideKey || !t.isStringLiteralLike(slideKey)) { valid = false; continue; }
        for (const name of ['targets', 'additions']) {
          const targets = property(slide, name);
          if (!targets) continue;
          if (!t.isArrayLiteralExpression(targets)) { valid = false; continue; }
          for (const target of targets.elements) {
            const key = t.isObjectLiteralExpression(target) ? property(target, 'editKey') : undefined;
            if (!key || !t.isStringLiteralLike(key)) { valid = false; continue; }
            result.add(`${slideKey.text}/${name}/${key.text}`);
          }
        }
      }
      return;
    }
    t.forEachChild(node, visit);
  }
  visit(sf);
  return valid ? result : null;
}

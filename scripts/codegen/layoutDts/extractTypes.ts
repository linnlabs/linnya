/**
 * extractTypes — pull top-level exported `interface` / `type` / `function`
 * declarations out of one or more `.ts` source files and emit them as
 * ready-to-paste d.ts text fragments.
 *
 * Design notes
 * ────────────
 * - We do **not** spin up a full `ts.Program` / `TypeChecker`. The .d.ts
 *   we generate is intentionally a near-textual snapshot of the source
 *   declarations (interfaces / type aliases keep their bodies verbatim,
 *   function declarations keep just the signature). Resolving cross-file
 *   types is out of scope; instead we report `externalDependencies` so
 *   the caller can decide whether to stub them.
 * - All extraction operates on the source text and AST positions of a
 *   single `ts.SourceFile` per input file. This keeps the helper
 *   pure / hermetic / fast and trivially testable.
 * - Output is **deterministic**: symbols are returned sorted by name and
 *   external dependencies are sorted by module specifier + name.
 */

import * as fs from 'node:fs';
import ts from 'typescript';

import { compareAscii } from './sort.js';

export type ExtractedSymbolKind = 'interface' | 'type-alias' | 'function';

/** A single extracted top-level declaration ready to be emitted into a .d.ts. */
export interface ExtractedTypeSymbol {
  name: string;
  kind: ExtractedSymbolKind;
  /** Render-ready text including any leading JSDoc, with `export` stripped
   *  and (for functions) `declare` prefixed and the body dropped. */
  text: string;
  /** Absolute path of the source file the symbol came from. */
  sourceFile: string;
}

/** A type/value imported from a non-extracted module. */
export interface ExternalDependency {
  /** The exact module specifier as written in source (e.g. `'./foo.js'`). */
  moduleName: string;
  /**
   * **Local** binding names (alias preserved — we report `RenamedBaz`,
   * not the original `Baz`). The local name is what appears in the
   * extracted symbol bodies, so this is what downstream consumers need
   * if they want to declare a stub like `type RenamedBaz = unknown;`.
   */
  importedNames: string[];
}

export interface ExtractTypesOptions {
  sourceFiles: string[];
}

export interface ExtractTypesResult {
  symbols: ExtractedTypeSymbol[];
  externalDependencies: ExternalDependency[];
  warnings: string[];
}

export function extractTypes(options: ExtractTypesOptions): ExtractTypesResult {
  const symbols: ExtractedTypeSymbol[] = [];
  const externalDeps = new Map<string, Set<string>>();
  const warnings: string[] = [];

  for (const filePath of options.sourceFiles) {
    const fileText = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      filePath,
      fileText,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );

    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt)) {
        collectImport(stmt, externalDeps);
        continue;
      }

      if (!hasExportModifier(stmt)) continue;

      if (ts.isInterfaceDeclaration(stmt)) {
        symbols.push({
          name: stmt.name.text,
          kind: 'interface',
          text: renderInterfaceOrTypeAlias(stmt, sourceFile, fileText),
          sourceFile: filePath,
        });
        continue;
      }

      if (ts.isTypeAliasDeclaration(stmt)) {
        symbols.push({
          name: stmt.name.text,
          kind: 'type-alias',
          text: renderInterfaceOrTypeAlias(stmt, sourceFile, fileText),
          sourceFile: filePath,
        });
        continue;
      }

      if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        symbols.push({
          name: stmt.name.text,
          kind: 'function',
          text: renderFunctionDeclaration(stmt, sourceFile, fileText),
          sourceFile: filePath,
        });
        continue;
      }
    }
  }

  symbols.sort((a, b) => compareAscii(a.name, b.name));
  const externalDependencies = [...externalDeps.entries()]
    .sort(([a], [b]) => compareAscii(a, b))
    .map(([moduleName, names]) => ({
      moduleName,
      importedNames: [...names].sort(compareAscii),
    }));

  return { symbols, externalDependencies, warnings };
}

// ─── internal helpers ──────────────────────────────────────────────────

function hasExportModifier(node: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Recover the leading `/** ... *\/` block (if any). We deliberately ignore
 * `// ...` line comments — only proper JSDoc carries documentation that is
 * useful in a generated .d.ts.
 */
function getLeadingJSDoc(node: ts.Node, fileText: string): string {
  const ranges = ts.getLeadingCommentRanges(fileText, node.pos) ?? [];
  const jsdocRanges = ranges.filter((r) =>
    fileText.slice(r.pos, r.end).startsWith('/**'),
  );
  if (jsdocRanges.length === 0) return '';
  return jsdocRanges.map((r) => fileText.slice(r.pos, r.end)).join('\n');
}

function renderInterfaceOrTypeAlias(
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
  sourceFile: ts.SourceFile,
  fileText: string,
): string {
  const jsdoc = getLeadingJSDoc(node, fileText);
  const declStart = node.getStart(sourceFile, /* includeJsDocComments */ false);
  const declEnd = node.getEnd();
  const body = stripExportKeyword(fileText.slice(declStart, declEnd));
  return jsdoc ? `${jsdoc}\n${body}` : body;
}

function renderFunctionDeclaration(
  node: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  fileText: string,
): string {
  const jsdoc = getLeadingJSDoc(node, fileText);
  const declStart = node.getStart(sourceFile, /* includeJsDocComments */ false);
  const bodyStart = node.body ? node.body.getStart(sourceFile) : node.getEnd();
  let signatureText = stripExportKeyword(
    fileText.slice(declStart, bodyStart).trimEnd(),
  );
  if (!signatureText.startsWith('declare ')) {
    signatureText = `declare ${signatureText}`;
  }
  signatureText = `${signatureText};`;
  return jsdoc ? `${jsdoc}\n${signatureText}` : signatureText;
}

function stripExportKeyword(text: string): string {
  return text.replace(/^\s*export\s+/, '');
}

function collectImport(
  stmt: ts.ImportDeclaration,
  deps: Map<string, Set<string>>,
): void {
  if (!ts.isStringLiteral(stmt.moduleSpecifier)) return;
  const moduleName = stmt.moduleSpecifier.text;
  const clause = stmt.importClause;
  if (!clause) return;

  const set = deps.get(moduleName) ?? new Set<string>();
  if (clause.name) set.add(clause.name.text); // default import
  if (clause.namedBindings) {
    if (ts.isNamedImports(clause.namedBindings)) {
      for (const elem of clause.namedBindings.elements) {
        // Use the *local* name (alias if present, otherwise original) so
        // downstream stub generators can declare a placeholder under the
        // exact identifier the extracted symbol bodies reference.
        set.add(elem.name.text);
      }
    } else if (ts.isNamespaceImport(clause.namedBindings)) {
      set.add(clause.namedBindings.name.text);
    }
  }
  deps.set(moduleName, set);
}

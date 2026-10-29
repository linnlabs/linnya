/** compose 的静态标识符列表定义显示顺序；源块边界始终来自声明顺序。 */
export function readStaticSlideOrder(program: unknown): readonly number[] | null {
  if (!record(program) || !Array.isArray(program.body)) return null;
  const declarations = new Map<string, Record<string, unknown>>();
  let compose: Record<string, unknown> | undefined;
  for (const statement of program.body) {
    if (!record(statement)) continue;
    if (statement.type === 'VariableDeclaration' && Array.isArray(statement.declarations)) {
      for (const declaration of statement.declarations) {
        if (record(declaration) && record(declaration.id) && typeof declaration.id.name === 'string' && record(declaration.init)) declarations.set(declaration.id.name, declaration.init);
      }
    }
    const call = statement.expression;
    if (statement.type === 'ExpressionStatement' && record(call) && record(call.callee) && call.callee.name === 'compose'
      && Array.isArray(call.arguments) && record(call.arguments[0])) compose = call.arguments[0];
  }
  if (!compose || !Array.isArray(compose.properties)) return null;
  const properties = compose.properties.filter(property => record(property) && record(property.key) && (property.key.name === 'slides' || property.key.value === 'slides'));
  const property = properties[0];
  if (properties.length !== 1 || !record(property) || !record(property.value)) return null;
  const value = property.value;
  const array = value.type === 'Identifier' && typeof value.name === 'string' ? declarations.get(value.name) : value;
  if (!array || array.type !== 'ArrayExpression' || !Array.isArray(array.elements)) return null;
  const lines: number[] = [];
  for (const element of array.elements) {
    if (!record(element) || element.type !== 'Identifier' || typeof element.name !== 'string') return null;
    const call = declarations.get(element.name);
    if (!call || call.type !== 'CallExpression' || !record(call.callee) || call.callee.name !== 'createSlide'
      || !record(call.loc) || !record(call.loc.start) || typeof call.loc.start.line !== 'number') return null;
    lines.push(call.loc.start.line);
  }
  return new Set(lines).size === lines.length ? lines : null;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

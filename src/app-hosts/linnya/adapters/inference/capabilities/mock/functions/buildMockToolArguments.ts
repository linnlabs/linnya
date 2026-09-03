function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createRequiredPropertyValue(name: string, schema: unknown): unknown {
  if (!isRecord(schema)) {
    throw new Error(`Mock tool parameter "${name}" must define a JSON schema.`);
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  switch (schema.type) {
    case 'string': return '测试';
    case 'integer':
    case 'number': return 1;
    case 'boolean': return true;
    case 'array': return [];
    case 'object': return {};
    default:
      throw new Error(`Mock tool parameter "${name}" has an unsupported JSON schema type.`);
  }
}

/**
 * canonical mock 只生成必填的简单 JSON Schema 参数，用于验证真实工具回放链。
 * 复杂 schema 应由专门 fixture 显式提供，不在这里猜值。
 */
export function buildMockToolArguments(parameters: unknown): Record<string, unknown> {
  if (!isRecord(parameters)) {
    throw new Error('Mock tool must expose an object JSON schema.');
  }
  const required = parameters.required;
  const properties = parameters.properties;
  if (required !== undefined &&
      (!Array.isArray(required) || !required.every(name => typeof name === 'string'))) {
    throw new Error('Mock tool JSON schema must define a string required array.');
  }
  if (!isRecord(properties)) {
    throw new Error('Mock tool JSON schema must define properties.');
  }
  const requiredNames = required ?? [];
  return Object.fromEntries(
    requiredNames.map(name => [name, createRequiredPropertyValue(name, properties[name])])
  );
}

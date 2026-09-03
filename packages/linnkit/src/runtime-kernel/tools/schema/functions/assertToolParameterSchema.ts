import type {
  ToolParameterProperty,
  ToolParameterSchema,
  ToolParameterType,
} from '../../toolContracts';

const TOOL_PARAMETER_TYPES: ReadonlySet<ToolParameterType> = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
]);

export class ToolParameterSchemaError extends Error {
  constructor(
    readonly schemaPath: string,
    message: string
  ) {
    super(`${schemaPath}: ${message}`);
    this.name = 'ToolParameterSchemaError';
  }
}

/**
 * 校验 Linnkit 正式工具 schema 子集。
 *
 * 中文备注：这里校验的是跨 Host/Provider 的公共合同，不替代工具 owner 对真实参数的业务校验。
 * 先在工具注册阶段拒绝不可无损重建的 schema，避免 Provider 请求时再静默删关键字。
 */
export function assertToolParameterSchema(schema: ToolParameterSchema, path = '$'): void {
  if (schema.type !== 'object') {
    throw new ToolParameterSchemaError(path, '根节点 type 必须为 object');
  }

  assertObjectShape(schema, path);
  assertOneOf(schema.oneOf, path);
}

function assertProperty(property: ToolParameterProperty, path: string): void {
  if (!TOOL_PARAMETER_TYPES.has(property.type)) {
    throw new ToolParameterSchemaError(path, `不支持的 type: ${String(property.type)}`);
  }
  if (!property.description.trim()) {
    throw new ToolParameterSchemaError(path, 'description 必须为非空字符串');
  }

  if (property.type === 'object') {
    assertObjectShape(property, path);
  } else if (property.properties !== undefined || property.required !== undefined) {
    throw new ToolParameterSchemaError(path, 'properties/required 只能用于 object');
  }

  if (property.type === 'array') {
    if (!property.items) {
      throw new ToolParameterSchemaError(path, 'array 必须显式声明 items');
    }
    assertProperty(property.items, `${path}.items`);
  } else if (property.items !== undefined) {
    throw new ToolParameterSchemaError(path, 'items 只能用于 array');
  }

  if (property.enum !== undefined) {
    if (property.type !== 'string') {
      throw new ToolParameterSchemaError(path, '当前 enum 子集只允许 string');
    }
    if (property.enum.length === 0 || new Set(property.enum).size !== property.enum.length) {
      throw new ToolParameterSchemaError(path, 'enum 必须非空且不能重复');
    }
  }

  if (
    (property.minLength !== undefined || property.maxLength !== undefined) &&
    property.type !== 'string'
  ) {
    throw new ToolParameterSchemaError(path, 'minLength/maxLength 只能用于 string');
  }
  if (
    (property.minItems !== undefined || property.maxItems !== undefined) &&
    property.type !== 'array'
  ) {
    throw new ToolParameterSchemaError(path, 'minItems/maxItems 只能用于 array');
  }
  if (
    (property.minimum !== undefined || property.maximum !== undefined) &&
    property.type !== 'number' &&
    property.type !== 'integer'
  ) {
    throw new ToolParameterSchemaError(path, 'minimum/maximum 只能用于 number/integer');
  }
  if (property.additionalProperties !== undefined && property.type !== 'object') {
    throw new ToolParameterSchemaError(path, 'additionalProperties 只能用于 object');
  }

  assertOrderedBounds(property.minLength, property.maxLength, path, 'Length');
  assertOrderedBounds(property.minItems, property.maxItems, path, 'Items');
  assertOrderedBounds(property.minimum, property.maximum, path, '');
  assertOneOf(property.oneOf, path);
}

function assertObjectShape(
  schema: {
    readonly properties?: Readonly<Record<string, ToolParameterProperty>>;
    readonly required?: readonly string[];
  },
  path: string
): void {
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    assertProperty(property, `${path}.properties.${name}`);
  }

  if (schema.required === undefined) return;
  if (new Set(schema.required).size !== schema.required.length) {
    throw new ToolParameterSchemaError(path, 'required 不能包含重复字段');
  }
  for (const name of schema.required) {
    if (!(name in (schema.properties ?? {}))) {
      throw new ToolParameterSchemaError(path, `required 引用了未声明字段: ${name}`);
    }
  }
}

function assertOneOf(
  variants: readonly ToolParameterProperty[] | readonly ToolParameterSchema[] | undefined,
  path: string
): void {
  if (variants === undefined) return;
  if (variants.length === 0) {
    throw new ToolParameterSchemaError(path, 'oneOf 不能为空');
  }
  variants.forEach((variant, index) => {
    const variantPath = `${path}.oneOf[${index}]`;
    if (variant.type === 'object') {
      assertObjectShape(variant, variantPath);
      assertOneOf(variant.oneOf, variantPath);
      return;
    }
    assertProperty(variant, variantPath);
  });
}

function assertOrderedBounds(
  minimum: number | undefined,
  maximum: number | undefined,
  path: string,
  suffix: string
): void {
  if (minimum !== undefined && (!Number.isFinite(minimum) || minimum < 0)) {
    throw new ToolParameterSchemaError(path, `min${suffix || 'imum'} 必须是非负有限数`);
  }
  if (maximum !== undefined && (!Number.isFinite(maximum) || maximum < 0)) {
    throw new ToolParameterSchemaError(path, `max${suffix || 'imum'} 必须是非负有限数`);
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new ToolParameterSchemaError(path, `min${suffix} 不能大于 max${suffix}`);
  }
}

import type { ToolParameterProperty, ToolParameterSchema } from '../runtime-kernel';

function serializeToolProperty(property: ToolParameterProperty): ToolParameterProperty {
  return {
    type: property.type,
    description: property.description,
    ...(property.default !== undefined ? { default: property.default } : {}),
    ...(property.enum !== undefined ? { enum: [...property.enum] } : {}),
    ...(property.minimum !== undefined ? { minimum: property.minimum } : {}),
    ...(property.maximum !== undefined ? { maximum: property.maximum } : {}),
    ...(property.minLength !== undefined ? { minLength: property.minLength } : {}),
    ...(property.minItems !== undefined ? { minItems: property.minItems } : {}),
    ...(property.maxItems !== undefined ? { maxItems: property.maxItems } : {}),
    ...(property.properties !== undefined
      ? {
          properties: Object.fromEntries(
            Object.entries(property.properties).map(([key, value]) => [
              key,
              serializeToolProperty(value),
            ])
          ),
        }
      : {}),
    ...(property.items !== undefined ? { items: serializeToolProperty(property.items) } : {}),
    ...(property.required !== undefined ? { required: [...property.required] } : {}),
    ...(property.additionalProperties !== undefined
      ? { additionalProperties: property.additionalProperties }
      : {}),
    ...(property.oneOf !== undefined ? { oneOf: property.oneOf.map(serializeToolProperty) } : {}),
  };
}

export function serializeToolParameters(schema: ToolParameterSchema): ToolParameterSchema {
  return {
    type: schema.type,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, serializeToolProperty(value)])
    ),
    ...(schema.required !== undefined ? { required: [...schema.required] } : {}),
    ...(schema.additionalProperties !== undefined
      ? { additionalProperties: schema.additionalProperties }
      : {}),
    ...(schema.oneOf !== undefined ? { oneOf: schema.oneOf.map(serializeToolParameters) } : {}),
  };
}

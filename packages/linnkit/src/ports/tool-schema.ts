export type JsonSchemaValue =
  | string
  | number
  | boolean
  | null
  | JsonSchemaValue[]
  | { [key: string]: JsonSchemaValue };

export type ToolParameterType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

export interface ToolParameterProperty {
  type: ToolParameterType;
  description: string;
  default?: JsonSchemaValue;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, ToolParameterProperty>;
  items?: ToolParameterProperty;
  required?: string[];
  additionalProperties?: boolean;
  oneOf?: ToolParameterProperty[];
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
  oneOf?: ToolParameterSchema[];
}

/**
 * Kriya Omnitask — MCP Schema Converter
 * Converts Kriya ToolDefinition and Zod validators into standard JSON Schema for MCP clients.
 */

import { z } from 'zod';
import { McpJsonSchema } from '../types/mcpTypes.js';
import { RegisteredTool } from '../../../tools/registry/toolRegistry.js';

export class McpSchemaConverter {
  /**
   * Converts a registered Kriya tool into an MCP-compliant JSON Schema inputSchema.
   */
  public static toJsonSchema(tool: RegisteredTool): McpJsonSchema {
    // 1. Try to introspect from Zod inputValidator if present
    if (tool.inputValidator) {
      const fromZod = this.convertZodSchema(tool.inputValidator);
      if (fromZod) {
        return fromZod;
      }
    }

    // 2. Fallback to tool.definition.inputSchema (record of property descriptions)
    return this.convertRecordSchema(tool.definition.inputSchema);
  }

  private static convertZodSchema(schema: z.ZodTypeAny): McpJsonSchema | null {
    try {
      let current: any = schema;

      // Unwrap ZodEffects (e.g. .refine(), .transform())
      while (current._def?.typeName === 'ZodEffects') {
        current = current._def.schema;
      }

      // Unwrap ZodDefault
      if (current._def?.typeName === 'ZodDefault') {
        current = current._def.innerType;
      }

      // If it's a ZodObject, inspect the shape
      if (current._def?.typeName === 'ZodObject' && typeof current._def.shape === 'function') {
        const shape = current._def.shape();
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, propSchemaRaw] of Object.entries(shape)) {
          const propSchema = propSchemaRaw as z.ZodTypeAny;
          const { jsonSchema, isRequired } = this.convertZodProperty(propSchema);
          properties[key] = jsonSchema;
          if (isRequired) {
            required.push(key);
          }
        }

        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
          additionalProperties: false,
        };
      }
    } catch {
      // Fallback on unexpected introspection structure
    }

    return null;
  }

  private static convertZodProperty(prop: z.ZodTypeAny): { jsonSchema: Record<string, unknown>; isRequired: boolean } {
    let current: any = prop;
    let isRequired = true;
    let description: string | undefined = (current as any).description;

    // Check for optional / nullable
    if (current._def?.typeName === 'ZodOptional') {
      isRequired = false;
      current = current._def.innerType;
    } else if (current._def?.typeName === 'ZodNullable') {
      isRequired = false;
      current = current._def.innerType;
    }

    if (current._def?.typeName === 'ZodDefault') {
      isRequired = false;
      current = current._def.innerType;
    }

    // Unwrap effects if any
    while (current._def?.typeName === 'ZodEffects') {
      current = current._def.schema;
    }

    const typeName = current._def?.typeName;
    const jsonSchema: Record<string, unknown> = {};

    if (description) {
      jsonSchema.description = description;
    }

    switch (typeName) {
      case 'ZodString':
        jsonSchema.type = 'string';
        break;
      case 'ZodNumber':
        jsonSchema.type = 'number';
        break;
      case 'ZodBoolean':
        jsonSchema.type = 'boolean';
        break;
      case 'ZodArray':
        jsonSchema.type = 'array';
        if (current._def.type) {
          jsonSchema.items = this.convertZodProperty(current._def.type).jsonSchema;
        }
        break;
      case 'ZodEnum':
        jsonSchema.type = 'string';
        jsonSchema.enum = current._def.values;
        break;
      case 'ZodNativeEnum':
        jsonSchema.type = 'string';
        jsonSchema.enum = Object.values(current._def.values);
        break;
      case 'ZodRecord':
        jsonSchema.type = 'object';
        jsonSchema.additionalProperties = true;
        break;
      case 'ZodObject':
        jsonSchema.type = 'object';
        jsonSchema.additionalProperties = true;
        break;
      default:
        jsonSchema.type = 'string';
        break;
    }

    return { jsonSchema, isRequired };
  }

  private static convertRecordSchema(schemaObj?: Record<string, unknown>): McpJsonSchema {
    if (!schemaObj || Object.keys(schemaObj).length === 0) {
      return {
        type: 'object',
        properties: {},
        additionalProperties: true,
      };
    }

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, desc] of Object.entries(schemaObj)) {
      const descStr = String(desc).toLowerCase();
      const isOptional = descStr.includes('optional');
      if (!isOptional) {
        required.push(key);
      }

      let type = 'string';
      if (descStr.includes('number')) {
        type = 'number';
      } else if (descStr.includes('bool')) {
        type = 'boolean';
      } else if (descStr.includes('array')) {
        type = 'array';
      } else if (descStr.includes('object') || descStr.includes('json')) {
        type = 'object';
      }

      properties[key] = {
        type,
        description: String(desc),
      };
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }
}

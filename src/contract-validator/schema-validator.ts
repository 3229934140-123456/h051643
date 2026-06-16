import {
  SchemaObject,
  ValidationResult,
  ValidationError,
  ObjectSchema,
  ArraySchema,
  StringSchema,
  NumberSchema,
  IntegerSchema,
  BooleanSchema,
  NullSchema,
} from '../types';

export class SchemaValidator {
  private errors: ValidationError[] = [];

  validate(data: any, schema: SchemaObject | undefined): ValidationResult {
    this.errors = [];

    if (!schema) {
      return { valid: true, errors: [] };
    }

    this.validateValue(data, schema, '$');

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
    };
  }

  private validateValue(data: any, schema: SchemaObject, path: string): void {
    if (this.isReference(schema)) {
      return;
    }

    if (data === null || data === undefined) {
      if ('nullable' in schema && schema.nullable) {
        return;
      }
      if (data === undefined) {
        return;
      }
      const schemaType = 'type' in schema ? schema.type : 'any non-null';
      this.addError(path, `Value is null but schema is not nullable`, schemaType, null);
      return;
    }

    if ('enum' in schema && schema.enum && schema.enum.length > 0) {
      if (!schema.enum.includes(data)) {
        this.addError(path, `Value "${data}" is not in enum [${schema.enum.join(', ')}]`, schema.enum, data);
        return;
      }
    }

    if ('allOf' in schema && schema.allOf) {
      for (const subSchema of schema.allOf) {
        this.validateValue(data, subSchema, path);
      }
      return;
    }

    if ('anyOf' in schema && schema.anyOf && schema.anyOf.length > 0) {
      const anyValid = schema.anyOf.some((subSchema) => {
        const validator = new SchemaValidator();
        const result = validator.validate(data, subSchema);
        return result.valid;
      });
      if (!anyValid) {
        this.addError(path, `Value does not match any of the "anyOf" schemas`, schema.anyOf.map((s) => this.getSchemaDesc(s)), data);
      }
      return;
    }

    if ('oneOf' in schema && schema.oneOf && schema.oneOf.length > 0) {
      const validCount = schema.oneOf.filter((subSchema) => {
        const validator = new SchemaValidator();
        const result = validator.validate(data, subSchema);
        return result.valid;
      }).length;

      if (validCount === 0) {
        this.addError(path, `Value does not match any of the "oneOf" schemas`, schema.oneOf.map((s) => this.getSchemaDesc(s)), data);
      } else if (validCount > 1) {
        this.addError(path, `Value matches ${validCount} of the "oneOf" schemas, expected exactly one`, 'exactly 1 match', `${validCount} matches`);
      }
      return;
    }

    const type = 'type' in schema ? schema.type : undefined;

    if (type) {
      this.validateType(data, type, schema, path);
    }
  }

  private getSchemaDesc(schema: SchemaObject): string {
    const type = 'type' in schema ? schema.type : 'object';
    if ('enum' in schema && schema.enum) return `enum[${schema.enum.join(', ')}]`;
    return String(type);
  }

  private validateType(data: any, type: string, schema: SchemaObject, path: string): void {
    switch (type) {
      case 'object':
        this.validateObject(data, schema as ObjectSchema, path);
        break;
      case 'array':
        this.validateArray(data, schema as ArraySchema, path);
        break;
      case 'string':
        this.validateString(data, schema as StringSchema, path);
        break;
      case 'number':
        this.validateNumber(data, schema as NumberSchema, path);
        break;
      case 'integer':
        this.validateInteger(data, schema as IntegerSchema, path);
        break;
      case 'boolean':
        this.validateBoolean(data, schema as BooleanSchema, path);
        break;
      case 'null':
        this.validateNull(data, schema as NullSchema, path);
        break;
      default:
        break;
    }
  }

  private validateObject(data: any, schema: ObjectSchema, path: string): void {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      this.addError(path, `Expected object but got ${this.getDataType(data)}`, 'object', this.getDataType(data));
      return;
    }

    const properties = schema.properties || {};
    const required = schema.required || [];

    for (const propName of required) {
      if (!(propName in data) || data[propName] === undefined) {
        const propSchema = properties[propName];
        const expected = propSchema ? this.getSchemaDesc(propSchema) : 'defined value';
        this.addError(`${path}.${propName}`, `Required property "${propName}" is missing`, expected, data[propName]);
      }
    }

    for (const [propName, propSchema] of Object.entries(properties)) {
      if (propName in data && data[propName] !== undefined) {
        this.validateValue(data[propName], propSchema, `${path}.${propName}`);
      }
    }

    if (schema.minProperties !== undefined) {
      const propCount = Object.keys(data).length;
      if (propCount < schema.minProperties) {
        this.addError(path, `Object has ${propCount} properties, minimum is ${schema.minProperties}`, `>= ${schema.minProperties}`, propCount);
      }
    }

    if (schema.maxProperties !== undefined) {
      const propCount = Object.keys(data).length;
      if (propCount > schema.maxProperties) {
        this.addError(path, `Object has ${propCount} properties, maximum is ${schema.maxProperties}`, `<= ${schema.maxProperties}`, propCount);
      }
    }

    if (schema.additionalProperties === false) {
      const knownProps = new Set(Object.keys(properties));
      for (const propName of Object.keys(data)) {
        if (!knownProps.has(propName)) {
          this.addError(`${path}.${propName}`, `Additional property "${propName}" is not allowed`, 'not allowed', data[propName]);
        }
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const knownProps = new Set(Object.keys(properties));
      for (const propName of Object.keys(data)) {
        if (!knownProps.has(propName)) {
          this.validateValue(data[propName], schema.additionalProperties as SchemaObject, `${path}.${propName}`);
        }
      }
    }
  }

  private validateArray(data: any, schema: ArraySchema, path: string): void {
    if (!Array.isArray(data)) {
      this.addError(path, `Expected array but got ${this.getDataType(data)}`, 'array', this.getDataType(data));
      return;
    }

    if (schema.minItems !== undefined && data.length < schema.minItems) {
      this.addError(path, `Array has ${data.length} items, minimum is ${schema.minItems}`, `>= ${schema.minItems}`, data.length);
    }

    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      this.addError(path, `Array has ${data.length} items, maximum is ${schema.maxItems}`, `<= ${schema.maxItems}`, data.length);
    }

    if (schema.uniqueItems) {
      const seen = new Set();
      for (let i = 0; i < data.length; i++) {
        const key = JSON.stringify(data[i]);
        if (seen.has(key)) {
          this.addError(`${path}[${i}]`, `Duplicate item in array`, 'unique value', data[i]);
          break;
        }
        seen.add(key);
      }
    }

    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        this.validateValue(data[i], schema.items, `${path}[${i}]`);
      }
    }
  }

  private validateString(data: any, schema: StringSchema, path: string): void {
    if (typeof data !== 'string') {
      this.addError(path, `Expected string but got ${this.getDataType(data)}`, 'string', this.getDataType(data));
      return;
    }

    if (schema.minLength !== undefined && data.length < schema.minLength) {
      this.addError(path, `String length is ${data.length}, minimum is ${schema.minLength}`, `>= ${schema.minLength} chars`, data.length);
    }

    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      this.addError(path, `String length is ${data.length}, maximum is ${schema.maxLength}`, `<= ${schema.maxLength} chars`, data.length);
    }

    if (schema.pattern) {
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(data)) {
          this.addError(path, `String "${data}" does not match pattern "${schema.pattern}"`, `pattern: ${schema.pattern}`, data);
        }
      } catch (e) {
        this.addError(path, `Invalid regex pattern: ${schema.pattern}`, 'valid regex', schema.pattern);
      }
    }

    if (schema.format) {
      this.validateFormat(data, schema.format, path);
    }
  }

  private validateFormat(value: string, format: string, path: string): void {
    switch (format) {
      case 'email': {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          this.addError(path, `"${value}" is not a valid email`, 'email format', value);
        }
        break;
      }
      case 'date': {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(value) || isNaN(Date.parse(value))) {
          this.addError(path, `"${value}" is not a valid date (expected YYYY-MM-DD)`, 'YYYY-MM-DD', value);
        }
        break;
      }
      case 'date-time': {
        if (isNaN(Date.parse(value))) {
          this.addError(path, `"${value}" is not a valid date-time`, 'ISO 8601 date-time', value);
        }
        break;
      }
      case 'uuid': {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(value)) {
          this.addError(path, `"${value}" is not a valid UUID`, 'UUID format', value);
        }
        break;
      }
      case 'uri':
      case 'url': {
        try {
          new URL(value);
        } catch {
          this.addError(path, `"${value}" is not a valid URI`, 'URI/URL format', value);
        }
        break;
      }
      case 'ipv4': {
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipv4Regex.test(value)) {
          this.addError(path, `"${value}" is not a valid IPv4 address`, 'IPv4 format', value);
        }
        break;
      }
      default:
        break;
    }
  }

  private validateNumber(data: any, schema: NumberSchema, path: string): void {
    if (typeof data !== 'number' || Number.isNaN(data)) {
      this.addError(path, `Expected number but got ${this.getDataType(data)}`, 'number', this.getDataType(data));
      return;
    }

    if (schema.minimum !== undefined && data < schema.minimum) {
      this.addError(path, `Value ${data} is less than minimum ${schema.minimum}`, `>= ${schema.minimum}`, data);
    }

    if (schema.maximum !== undefined && data > schema.maximum) {
      this.addError(path, `Value ${data} is greater than maximum ${schema.maximum}`, `<= ${schema.maximum}`, data);
    }

    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
      this.addError(path, `Value ${data} must be greater than exclusive minimum ${schema.exclusiveMinimum}`, `> ${schema.exclusiveMinimum}`, data);
    }

    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) {
      this.addError(path, `Value ${data} must be less than exclusive maximum ${schema.exclusiveMaximum}`, `< ${schema.exclusiveMaximum}`, data);
    }

    if (schema.multipleOf !== undefined && schema.multipleOf !== 0) {
      if (data % schema.multipleOf !== 0) {
        this.addError(path, `Value ${data} is not a multiple of ${schema.multipleOf}`, `multiple of ${schema.multipleOf}`, data);
      }
    }
  }

  private validateInteger(data: any, schema: IntegerSchema, path: string): void {
    if (typeof data !== 'number' || !Number.isInteger(data) || Number.isNaN(data)) {
      this.addError(path, `Expected integer but got ${this.getDataType(data)}`, 'integer', this.getDataType(data));
      return;
    }

    if (schema.minimum !== undefined && data < schema.minimum) {
      this.addError(path, `Value ${data} is less than minimum ${schema.minimum}`, `>= ${schema.minimum}`, data);
    }

    if (schema.maximum !== undefined && data > schema.maximum) {
      this.addError(path, `Value ${data} is greater than maximum ${schema.maximum}`, `<= ${schema.maximum}`, data);
    }

    if (schema.multipleOf !== undefined && schema.multipleOf !== 0) {
      if (data % schema.multipleOf !== 0) {
        this.addError(path, `Value ${data} is not a multiple of ${schema.multipleOf}`, `multiple of ${schema.multipleOf}`, data);
      }
    }
  }

  private validateBoolean(data: any, schema: BooleanSchema, path: string): void {
    if (typeof data !== 'boolean') {
      this.addError(path, `Expected boolean but got ${this.getDataType(data)}`, 'boolean', this.getDataType(data));
    }
  }

  private validateNull(data: any, schema: NullSchema, path: string): void {
    if (data !== null) {
      this.addError(path, `Expected null but got ${this.getDataType(data)}`, 'null', this.getDataType(data));
    }
  }

  private getDataType(data: any): string {
    if (data === null) return 'null';
    if (data === undefined) return 'undefined';
    if (Array.isArray(data)) return 'array';
    return typeof data;
  }

  private addError(path: string, message: string, expected?: any, actual?: any): void {
    this.errors.push({ path, message, expected, actual });
  }

  private isReference(schema: SchemaObject): boolean {
    return schema && typeof schema === 'object' && '$ref' in schema;
  }
}

export function validateAgainstSchema(data: any, schema: SchemaObject): ValidationResult {
  const validator = new SchemaValidator();
  return validator.validate(data, schema);
}

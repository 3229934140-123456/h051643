import { SchemaObject, ObjectSchema, ArraySchema, StringSchema, NumberSchema, IntegerSchema, BooleanSchema } from '../types';

export class SchemaDataGenerator {
  private seed: number = 12345;

  constructor(seed?: number) {
    if (seed !== undefined) {
      this.seed = seed;
    }
  }

  private random(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  private randomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(this.random() * chars.length));
    }
    return result;
  }

  generate(schema: SchemaObject | undefined, context?: { propertyName?: string; example?: any }): any {
    if (!schema) {
      return null;
    }

    if ('example' in schema && schema.example !== undefined) {
      return schema.example;
    }

    if ('default' in schema && schema.default !== undefined) {
      return schema.default;
    }

    if ('enum' in schema && schema.enum && schema.enum.length > 0) {
      return schema.enum[Math.floor(this.random() * schema.enum.length)];
    }

    if ('allOf' in schema && schema.allOf) {
      return this.generateAllOf(schema.allOf);
    }

    if ('anyOf' in schema && schema.anyOf && schema.anyOf.length > 0) {
      const index = Math.floor(this.random() * schema.anyOf.length);
      return this.generate(schema.anyOf[index]);
    }

    if ('oneOf' in schema && schema.oneOf && schema.oneOf.length > 0) {
      const index = Math.floor(this.random() * schema.oneOf.length);
      return this.generate(schema.oneOf[index]);
    }

    if ('nullable' in schema && schema.nullable && this.random() < 0.1) {
      return null;
    }

    const type = 'type' in schema ? schema.type : undefined;

    switch (type) {
      case 'object':
        return this.generateObject(schema as ObjectSchema);
      case 'array':
        return this.generateArray(schema as ArraySchema);
      case 'string':
        return this.generateString(schema as StringSchema, context?.propertyName);
      case 'number':
        return this.generateNumber(schema as NumberSchema);
      case 'integer':
        return this.generateInteger(schema as IntegerSchema);
      case 'boolean':
        return this.generateBoolean(schema as BooleanSchema);
      case 'null':
        return null;
      default:
        return this.generateUnknown(schema);
    }
  }

  private generateAllOf(schemas: SchemaObject[]): any {
    let result: any = {};
    for (const schema of schemas) {
      const generated = this.generate(schema);
      if (typeof generated === 'object' && generated !== null) {
        result = { ...result, ...generated };
      }
    }
    return result;
  }

  private generateObject(schema: ObjectSchema): any {
    const result: any = {};
    const properties = schema.properties || {};
    const required = schema.required || [];

    for (const [propName, propSchema] of Object.entries(properties)) {
      const isRequired = required.includes(propName);
      if (isRequired || this.random() < 0.7) {
        result[propName] = this.generate(propSchema, { propertyName: propName });
      }
    }

    if (schema.additionalProperties && schema.additionalProperties !== true && typeof schema.additionalProperties === 'object') {
      const additionalCount = this.randomInt(1, 3);
      for (let i = 0; i < additionalCount; i++) {
        const propName = `extra_${this.randomString(5)}`;
        result[propName] = this.generate(schema.additionalProperties as SchemaObject);
      }
    }

    return result;
  }

  private generateArray(schema: ArraySchema): any[] {
    const minItems = schema.minItems || 0;
    const maxItems = schema.maxItems || 5;
    const count = this.randomInt(minItems, maxItems);

    const result: any[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.generate(schema.items));
    }

    if (schema.uniqueItems) {
      const unique = new Set(result.map((item) => JSON.stringify(item)));
      return Array.from(unique).map((item) => JSON.parse(item));
    }

    return result;
  }

  private generateString(schema: StringSchema, propertyName?: string): string {
    const format = schema.format;
    const minLength = schema.minLength || 3;
    const maxLength = schema.maxLength || 20;

    if (format) {
      return this.generateFormattedString(format, propertyName);
    }

    if (propertyName) {
      const namedValue = this.generateNamedString(propertyName);
      if (namedValue) return namedValue;
    }

    const length = this.randomInt(minLength, maxLength);
    return this.randomString(length);
  }

  private generateFormattedString(format: string, propertyName?: string): string {
    switch (format) {
      case 'date':
        return this.generateDate();
      case 'date-time':
        return this.generateDateTime();
      case 'email':
        return `${this.randomString(8).toLowerCase()}@example.com`;
      case 'uuid':
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.floor(this.random() * 16);
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      case 'uri':
      case 'url':
        return `https://example.com/${this.randomString(8).toLowerCase()}`;
      case 'hostname':
        return `${this.randomString(8).toLowerCase()}.com`;
      case 'ipv4':
        return `${this.randomInt(1, 255)}.${this.randomInt(0, 255)}.${this.randomInt(0, 255)}.${this.randomInt(1, 254)}`;
      default:
        return this.randomString(10);
    }
  }

  private generateNamedString(propertyName: string): string | null {
    const lowerName = propertyName.toLowerCase();

    if (lowerName.includes('name') || lowerName.includes('title')) {
      const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
      return names[this.randomInt(0, names.length - 1)];
    }
    if (lowerName.includes('email')) {
      return `${this.randomString(6).toLowerCase()}@example.com`;
    }
    if (lowerName.includes('id')) {
      return `id_${this.randomString(8)}`;
    }
    if (lowerName.includes('status') || lowerName.includes('state')) {
      const statuses = ['active', 'inactive', 'pending', 'archived'];
      return statuses[this.randomInt(0, statuses.length - 1)];
    }
    if (lowerName.includes('description')) {
      return `This is a description of ${propertyName}.`;
    }
    if (lowerName.includes('url') || lowerName.includes('link')) {
      return `https://example.com/${this.randomString(8).toLowerCase()}`;
    }
    if (lowerName.includes('phone') || lowerName.includes('mobile')) {
      return `138${this.randomInt(10000000, 99999999)}`;
    }
    if (lowerName.includes('address')) {
      return `${this.randomInt(1, 999)} Main St, City`;
    }

    return null;
  }

  private generateDate(): string {
    const year = this.randomInt(2020, 2030);
    const month = this.randomInt(1, 12);
    const day = this.randomInt(1, 28);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private generateDateTime(): string {
    const date = this.generateDate();
    const hours = this.randomInt(0, 23);
    const minutes = this.randomInt(0, 59);
    const seconds = this.randomInt(0, 59);
    return `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}Z`;
  }

  private generateNumber(schema: NumberSchema): number {
    const minimum = schema.minimum ?? 0;
    const maximum = schema.maximum ?? 1000;
    const multipleOf = schema.multipleOf;

    let value = minimum + this.random() * (maximum - minimum);

    if (multipleOf) {
      value = Math.round(value / multipleOf) * multipleOf;
    }

    return Math.round(value * 100) / 100;
  }

  private generateInteger(schema: IntegerSchema): number {
    const minimum = schema.minimum ?? 0;
    const maximum = schema.maximum ?? 1000;

    return this.randomInt(minimum, maximum);
  }

  private generateBoolean(schema: BooleanSchema): boolean {
    return this.random() < 0.5;
  }

  private generateUnknown(schema: SchemaObject): any {
    if ('properties' in schema) {
      return this.generateObject(schema as ObjectSchema);
    }
    if ('items' in schema) {
      return this.generateArray(schema as ArraySchema);
    }
    return null;
  }
}

export function generateMockData(schema: SchemaObject, seed?: number): any {
  const generator = new SchemaDataGenerator(seed);
  return generator.generate(schema);
}

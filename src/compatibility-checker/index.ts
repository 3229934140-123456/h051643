import {
  ApiModel,
  Endpoint,
  CompatibilityResult,
  BreakingChange,
  NonBreakingChange,
  SchemaObject,
  ParameterObject,
  ResponseObject,
  ObjectSchema,
  ArraySchema,
} from '../types';

export class CompatibilityChecker {
  private breakingChanges: BreakingChange[] = [];
  private nonBreakingChanges: NonBreakingChange[] = [];

  check(oldSpec: ApiModel, newSpec: ApiModel): CompatibilityResult {
    this.breakingChanges = [];
    this.nonBreakingChanges = [];

    this.checkEndpoints(oldSpec, newSpec);
    this.checkSchemas(oldSpec, newSpec);

    return {
      isCompatible: this.breakingChanges.length === 0,
      breakingChanges: this.breakingChanges,
      nonBreakingChanges: this.nonBreakingChanges,
    };
  }

  private checkEndpoints(oldSpec: ApiModel, newSpec: ApiModel): void {
    const oldEndpoints = new Map<string, Endpoint>();
    const newEndpoints = new Map<string, Endpoint>();

    for (const ep of oldSpec.endpoints) {
      oldEndpoints.set(`${ep.method}:${ep.path}`, ep);
    }
    for (const ep of newSpec.endpoints) {
      newEndpoints.set(`${ep.method}:${ep.path}`, ep);
    }

    for (const [key, oldEp] of oldEndpoints) {
      const newEp = newEndpoints.get(key);
      if (!newEp) {
        this.addBreakingChange('removed-endpoint', oldEp.path, oldEp.method, `Endpoint removed: ${oldEp.method.toUpperCase()} ${oldEp.path}`);
      } else {
        this.checkEndpointCompatibility(oldEp, newEp);
      }
    }

    for (const [key, newEp] of newEndpoints) {
      if (!oldEndpoints.has(key)) {
        this.addNonBreakingChange('added-endpoint', newEp.path, newEp.method, `New endpoint added: ${newEp.method.toUpperCase()} ${newEp.path}`);
      }
    }
  }

  private checkEndpointCompatibility(oldEp: Endpoint, newEp: Endpoint): void {
    this.checkParameters(oldEp, newEp);
    this.checkRequestBodies(oldEp, newEp);
    this.checkResponses(oldEp, newEp);
  }

  private checkParameters(oldEp: Endpoint, newEp: Endpoint): void {
    const oldParams = new Map<string, ParameterObject>();
    const newParams = new Map<string, ParameterObject>();

    for (const p of oldEp.parameters) {
      oldParams.set(`${p.in}:${p.name}`, p);
    }
    for (const p of newEp.parameters) {
      newParams.set(`${p.in}:${p.name}`, p);
    }

    for (const [key, oldParam] of oldParams) {
      const newParam = newParams.get(key);
      if (!newParam) {
        if (oldParam.required) {
          this.addBreakingChange(
            'removed-parameter',
            oldEp.path,
            oldEp.method,
            `Required parameter removed: ${oldParam.name} (in ${oldParam.in})`,
          );
        } else {
          this.addNonBreakingChange(
            'added-parameter',
            oldEp.path,
            oldEp.method,
            `Optional parameter removed: ${oldParam.name} (in ${oldParam.in})`,
          );
        }
      } else {
        this.checkParameterCompatibility(oldParam, newParam, oldEp.path, oldEp.method);
      }
    }

    for (const [key, newParam] of newParams) {
      if (!oldParams.has(key)) {
        if (newParam.required) {
          this.addBreakingChange(
            'added-required',
            oldEp.path,
            oldEp.method,
            `New required parameter added: ${newParam.name} (in ${newParam.in})`,
          );
        } else {
          this.addNonBreakingChange(
            'added-parameter',
            oldEp.path,
            oldEp.method,
            `New optional parameter added: ${newParam.name} (in ${newParam.in})`,
          );
        }
      }
    }
  }

  private checkParameterCompatibility(
    oldParam: ParameterObject,
    newParam: ParameterObject,
    path: string,
    method: string,
  ): void {
    if (oldParam.required && !newParam.required) {
      this.addNonBreakingChange(
        'added-parameter',
        path,
        method,
        `Parameter "${oldParam.name}" changed from required to optional`,
      );
    }
    if (!oldParam.required && newParam.required) {
      this.addBreakingChange(
        'changed-required',
        path,
        method,
        `Parameter "${oldParam.name}" changed from optional to required`,
      );
    }

    if (oldParam.schema && newParam.schema) {
      this.checkSchemaCompatibility(
        oldParam.schema,
        newParam.schema,
        `parameter.${oldParam.name}`,
        path,
        method,
        false,
      );
    }
  }

  private checkRequestBodies(oldEp: Endpoint, newEp: Endpoint): void {
    const oldBody = oldEp.requestBody;
    const newBody = newEp.requestBody;

    if (!oldBody && newBody) {
      if (newBody.required) {
        this.addBreakingChange(
          'added-required',
          oldEp.path,
          oldEp.method,
          'New required request body added',
        );
      }
      return;
    }

    if (oldBody && !newBody) {
      this.addNonBreakingChange(
        'added-endpoint',
        oldEp.path,
        oldEp.method,
        'Request body removed',
      );
      return;
    }

    if (oldBody && newBody) {
      if (oldBody.required && !newBody.required) {
        this.addNonBreakingChange(
          'added-endpoint',
          oldEp.path,
          oldEp.method,
          'Request body changed from required to optional',
        );
      }
      if (!oldBody.required && newBody.required) {
        this.addBreakingChange(
          'changed-required',
          oldEp.path,
          oldEp.method,
          'Request body changed from optional to required',
        );
      }

      const oldSchema = oldBody.content?.['application/json']?.schema;
      const newSchema = newBody.content?.['application/json']?.schema;

      if (oldSchema && newSchema) {
        this.checkSchemaCompatibility(oldSchema, newSchema, 'requestBody', oldEp.path, oldEp.method, false);
      }
    }
  }

  private checkResponses(oldEp: Endpoint, newEp: Endpoint): void {
    const oldResponses = oldEp.responses;
    const newResponses = newEp.responses;

    for (const [statusCode, oldResponse] of Object.entries(oldResponses)) {
      const newResponse = newResponses[statusCode];
      if (!newResponse) {
        this.addBreakingChange(
          'removed-endpoint',
          oldEp.path,
          oldEp.method,
          `Response ${statusCode} removed`,
        );
      } else {
        this.checkResponseCompatibility(oldResponse, newResponse, statusCode, oldEp.path, oldEp.method);
      }
    }

    for (const [statusCode] of Object.entries(newResponses)) {
      if (!oldResponses[statusCode]) {
        this.addNonBreakingChange(
          'added-response',
          oldEp.path,
          oldEp.method,
          `New response status ${statusCode} added`,
        );
      }
    }
  }

  private checkResponseCompatibility(
    oldResponse: ResponseObject,
    newResponse: ResponseObject,
    statusCode: string,
    path: string,
    method: string,
  ): void {
    const oldSchema = oldResponse.content?.['application/json']?.schema;
    const newSchema = newResponse.content?.['application/json']?.schema;

    if (oldSchema && newSchema) {
      this.checkSchemaCompatibility(oldSchema, newSchema, `response.${statusCode}`, path, method, true);
    }
  }

  private checkSchemaCompatibility(
    oldSchema: SchemaObject,
    newSchema: SchemaObject,
    basePath: string,
    endpointPath: string,
    method: string | undefined,
    isResponse: boolean,
  ): void {
    const oldType = this.getSchemaType(oldSchema);
    const newType = this.getSchemaType(newSchema);

    if (oldType && newType && oldType !== newType) {
      this.addBreakingChange(
        'changed-type',
        endpointPath,
        method,
        `${basePath}: type changed from ${oldType} to ${newType}`,
        oldType,
        newType,
      );
      return;
    }

    if (oldType === 'object' && newType === 'object') {
      this.checkObjectSchemaCompatibility(
        oldSchema as ObjectSchema,
        newSchema as ObjectSchema,
        basePath,
        endpointPath,
        method,
        isResponse,
      );
    }

    if (oldType === 'array' && newType === 'array') {
      const oldItems = (oldSchema as ArraySchema).items;
      const newItems = (newSchema as ArraySchema).items;
      if (oldItems && newItems) {
        this.checkSchemaCompatibility(oldItems, newItems, `${basePath}.items`, endpointPath, method, isResponse);
      }
    }
  }

  private checkObjectSchemaCompatibility(
    oldSchema: ObjectSchema,
    newSchema: ObjectSchema,
    basePath: string,
    endpointPath: string,
    method: string | undefined,
    isResponse: boolean,
  ): void {
    const oldProps = oldSchema.properties || {};
    const newProps = newSchema.properties || {};
    const oldRequired = new Set(oldSchema.required || []);
    const newRequired = new Set(newSchema.required || []);

    for (const [propName, oldPropSchema] of Object.entries(oldProps)) {
      const newPropSchema = newProps[propName];

      if (!newPropSchema) {
        if (oldRequired.has(propName)) {
          this.addBreakingChange(
            'removed-property',
            endpointPath,
            method,
            `${basePath}: required property "${propName}" removed`,
          );
        } else if (isResponse) {
          this.addBreakingChange(
            'removed-property',
            endpointPath,
            method,
            `${basePath}: response property "${propName}" removed`,
          );
        }
        continue;
      }

      const wasRequired = oldRequired.has(propName);
      const isNowRequired = newRequired.has(propName);

      if (wasRequired && !isNowRequired && !isResponse) {
        this.addNonBreakingChange(
          'added-property',
          endpointPath,
          method,
          `${basePath}: property "${propName}" changed from required to optional`,
        );
      }

      if (!wasRequired && isNowRequired && !isResponse) {
        this.addBreakingChange(
          'changed-required',
          endpointPath,
          method,
          `${basePath}: property "${propName}" changed from optional to required`,
        );
      }

      this.checkSchemaCompatibility(
        oldPropSchema,
        newPropSchema,
        `${basePath}.${propName}`,
        endpointPath,
        method,
        isResponse,
      );
    }

    for (const [propName] of Object.entries(newProps)) {
      if (!oldProps[propName]) {
        if (newRequired.has(propName) && !isResponse) {
          this.addBreakingChange(
            'added-required',
            endpointPath,
            method,
            `${basePath}: new required property "${propName}" added`,
          );
        } else {
          this.addNonBreakingChange(
            'added-property',
            endpointPath,
            method,
            `${basePath}: new property "${propName}" added`,
          );
        }
      }
    }
  }

  private checkSchemas(oldSpec: ApiModel, newSpec: ApiModel): void {
    const oldSchemas = oldSpec.schemas || {};
    const newSchemas = newSpec.schemas || {};

    for (const [name, oldSchema] of Object.entries(oldSchemas)) {
      const newSchema = newSchemas[name];
      if (!newSchema) {
        this.addBreakingChange(
          'removed-property',
          `#/components/schemas/${name}`,
          undefined,
          `Schema "${name}" removed`,
        );
      } else {
        this.checkSchemaCompatibility(
          oldSchema,
          newSchema,
          `schemas.${name}`,
          `#/components/schemas/${name}`,
          undefined,
          true,
        );
      }
    }

    for (const [name] of Object.entries(newSchemas)) {
      if (!oldSchemas[name]) {
        this.addNonBreakingChange(
          'added-property',
          `#/components/schemas/${name}`,
          undefined,
          `New schema "${name}" added`,
        );
      }
    }
  }

  private getSchemaType(schema: SchemaObject): string | undefined {
    if ('type' in schema) {
      return schema.type as string;
    }
    if ('allOf' in schema || 'anyOf' in schema || 'oneOf' in schema) {
      return 'object';
    }
    return undefined;
  }

  private addBreakingChange(
    type: BreakingChange['type'],
    path: string,
    method: string | undefined,
    message: string,
    oldValue?: any,
    newValue?: any,
  ): void {
    const change: any = {
      type,
      path,
      message,
      oldValue,
      newValue,
    };
    if (method !== undefined) {
      change.method = method;
    }
    this.breakingChanges.push(change as BreakingChange);
  }

  private addNonBreakingChange(
    type: NonBreakingChange['type'],
    path: string,
    method: string | undefined,
    message: string,
  ): void {
    const change: any = {
      type,
      path,
      message,
    };
    if (method !== undefined) {
      change.method = method;
    }
    this.nonBreakingChanges.push(change as NonBreakingChange);
  }
}

export function checkCompatibility(oldSpec: ApiModel, newSpec: ApiModel): CompatibilityResult {
  const checker = new CompatibilityChecker();
  return checker.check(oldSpec, newSpec);
}

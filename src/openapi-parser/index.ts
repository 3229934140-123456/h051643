import {
  OpenAPISpec,
  ApiModel,
  Endpoint,
  HttpMethod,
  SchemaObject,
  ReferenceObject,
  ParameterObject,
  ResponseObject,
  RequestBodyObject,
  PathItemObject,
  MediaTypeObject,
} from '../types';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

export class OpenAPIParser {
  private spec: OpenAPISpec;

  constructor(spec: OpenAPISpec) {
    this.spec = spec;
  }

  parse(): ApiModel {
    const endpoints = this.parseEndpoints();
    const schemas = this.parseSchemas();

    return {
      info: this.spec.info,
      servers: this.spec.servers || [],
      tags: this.spec.tags || [],
      endpoints,
      schemas,
    };
  }

  private parseEndpoints(): Endpoint[] {
    const endpoints: Endpoint[] = [];
    const paths = this.spec.paths;

    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue;

      const pathParameters = pathItem.parameters || [];

      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (!operation) continue;

        const allParameters = [
          ...pathParameters.map((p) => this.resolveParameter(p)),
          ...(operation.parameters || []).map((p) => this.resolveParameter(p)),
        ];

        const responses: { [statusCode: string]: ResponseObject } = {};
        for (const [statusCode, response] of Object.entries(operation.responses)) {
          responses[statusCode] = this.resolveResponse(response);
        }

        const endpoint: Endpoint = {
          path,
          method,
          summary: operation.summary,
          description: operation.description,
          operationId: operation.operationId,
          tags: operation.tags || [],
          parameters: allParameters,
          requestBody: operation.requestBody ? this.resolveRequestBody(operation.requestBody) : undefined,
          responses,
          deprecated: operation.deprecated,
        };

        endpoints.push(endpoint);
      }
    }

    return endpoints;
  }

  private parseSchemas(): { [key: string]: SchemaObject } {
    const schemas: { [key: string]: SchemaObject } = {};
    const componentSchemas = this.spec.components?.schemas || {};

    for (const [name, schema] of Object.entries(componentSchemas)) {
      schemas[name] = this.resolveSchema(schema);
    }

    return schemas;
  }

  resolveReference<T>(ref: string): T {
    const parts = ref.replace('#/', '').split('/');
    let current: any = this.spec;

    for (const part of parts) {
      current = current?.[decodeURIComponent(part)];
    }

    return current as T;
  }

  isReference(obj: any): obj is ReferenceObject {
    return obj && typeof obj === 'object' && '$ref' in obj;
  }

  resolveSchema(schema: SchemaObject): SchemaObject {
    if (this.isReference(schema)) {
      const resolved = this.resolveReference<SchemaObject>(schema.$ref);
      return this.resolveSchema(resolved);
    }

    const result: any = { ...schema };

    if ('allOf' in result && result.allOf) {
      result.allOf = result.allOf.map((s: SchemaObject) => this.resolveSchema(s));
    }
    if ('anyOf' in result && result.anyOf) {
      result.anyOf = result.anyOf.map((s: SchemaObject) => this.resolveSchema(s));
    }
    if ('oneOf' in result && result.oneOf) {
      result.oneOf = result.oneOf.map((s: SchemaObject) => this.resolveSchema(s));
    }

    if (result.type === 'object' && (result as any).properties) {
      const resolvedProperties: { [key: string]: SchemaObject } = {};
      for (const [propName, propSchema] of Object.entries((result as any).properties)) {
        resolvedProperties[propName] = this.resolveSchema(propSchema as SchemaObject);
      }
      (result as any).properties = resolvedProperties;
    }

    if (result.type === 'array' && result.items) {
      result.items = this.resolveSchema(result.items);
    }

    if (result.additionalProperties && typeof result.additionalProperties === 'object') {
      result.additionalProperties = this.resolveSchema(result.additionalProperties as SchemaObject);
    }

    return result as SchemaObject;
  }

  resolveParameter(param: ParameterObject | ReferenceObject): ParameterObject {
    if (this.isReference(param)) {
      const resolved = this.resolveReference<ParameterObject>(param.$ref);
      return this.resolveParameter(resolved);
    }

    const result = { ...param };
    if (result.schema) {
      result.schema = this.resolveSchema(result.schema);
    }

    return result;
  }

  resolveResponse(response: ResponseObject | ReferenceObject): ResponseObject {
    if (this.isReference(response)) {
      const resolved = this.resolveReference<ResponseObject>(response.$ref);
      return this.resolveResponse(resolved);
    }

    const result: ResponseObject = {
      description: response.description,
      headers: response.headers,
    };

    if (response.content) {
      const resolvedContent: { [key: string]: MediaTypeObject } = {};
      for (const [mediaType, mediaObj] of Object.entries(response.content)) {
        resolvedContent[mediaType] = {
          ...mediaObj,
          schema: mediaObj.schema ? this.resolveSchema(mediaObj.schema) : undefined,
        };
      }
      result.content = resolvedContent;
    }

    return result;
  }

  resolveRequestBody(requestBody: RequestBodyObject | ReferenceObject): RequestBodyObject {
    if (this.isReference(requestBody)) {
      const resolved = this.resolveReference<RequestBodyObject>(requestBody.$ref);
      return this.resolveRequestBody(resolved);
    }

    const result: RequestBodyObject = {
      description: requestBody.description,
      required: requestBody.required,
      content: {},
    };

    for (const [mediaType, mediaObj] of Object.entries(requestBody.content)) {
      result.content[mediaType] = {
        ...mediaObj,
        schema: mediaObj.schema ? this.resolveSchema(mediaObj.schema) : undefined,
      };
    }

    return result;
  }

  findEndpoint(path: string, method: HttpMethod): Endpoint | undefined {
    const apiModel = this.parse();
    return apiModel.endpoints.find((ep) => ep.path === path && ep.method === method);
  }

  getResponseSchema(endpoint: Endpoint, statusCode: string = '200', contentType: string = 'application/json'): SchemaObject | undefined {
    const response = endpoint.responses[statusCode];
    if (!response?.content) return undefined;

    const mediaObj = response.content[contentType];
    return mediaObj?.schema;
  }

  getRequestSchema(endpoint: Endpoint, contentType: string = 'application/json'): SchemaObject | undefined {
    if (!endpoint.requestBody?.content) return undefined;

    const mediaObj = endpoint.requestBody.content[contentType];
    return mediaObj?.schema;
  }
}

export function parseOpenAPI(spec: OpenAPISpec): ApiModel {
  const parser = new OpenAPIParser(spec);
  return parser.parse();
}

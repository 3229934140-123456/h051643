import {
  ApiModel,
  Endpoint,
  MockRequest,
  MockResponse,
  SchemaObject,
  MockState,
  HttpMethod,
} from '../types';
import { SchemaDataGenerator } from './schema-generator';
import { OpenAPIParser } from '../openapi-parser';

interface RouteMatch {
  endpoint: Endpoint;
  pathParams: { [key: string]: string };
}

export class MockEngine {
  private apiModel: ApiModel;
  private parser: OpenAPIParser;
  private dataGenerator: SchemaDataGenerator;
  private state: MockState;
  private customHandlers: Map<string, (req: MockRequest, match: RouteMatch) => MockResponse>;

  constructor(apiModel: ApiModel, parser: OpenAPIParser, seed?: number) {
    this.apiModel = apiModel;
    this.parser = parser;
    this.dataGenerator = new SchemaDataGenerator(seed);
    this.state = {
      resources: {},
      nextIds: {},
    };
    this.customHandlers = new Map();
  }

  resetState(): void {
    this.state = {
      resources: {},
      nextIds: {},
    };
  }

  getState(): MockState {
    return JSON.parse(JSON.stringify(this.state));
  }

  setState(state: MockState): void {
    this.state = JSON.parse(JSON.stringify(state));
  }

  setCustomHandler(method: string, path: string, handler: (req: MockRequest, match: RouteMatch) => MockResponse): void {
    this.customHandlers.set(`${method.toUpperCase()}:${path}`, handler);
  }

  handleRequest(request: MockRequest): MockResponse {
    const match = this.matchRoute(request.path, request.method);

    if (!match) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Not Found', message: `No route found for ${request.method} ${request.path}` },
      };
    }

    const customKey = `${request.method.toUpperCase()}:${match.endpoint.path}`;
    const customHandler = this.customHandlers.get(customKey);
    if (customHandler) {
      return customHandler(request, match);
    }

    return this.generateMockResponse(request, match);
  }

  private matchRoute(path: string, method: HttpMethod): RouteMatch | undefined {
    for (const endpoint of this.apiModel.endpoints) {
      if (endpoint.method !== method) continue;

      const pathParams = this.matchPathPattern(endpoint.path, path);
      if (pathParams !== null) {
        return { endpoint, pathParams };
      }
    }
    return undefined;
  }

  private matchPathPattern(pattern: string, actual: string): { [key: string]: string } | null {
    const patternParts = pattern.split('/').filter((p) => p !== '');
    const actualParts = actual.split('/').filter((p) => p !== '');

    if (patternParts.length !== actualParts.length) {
      return null;
    }

    const params: { [key: string]: string } = {};

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const actualPart = actualParts[i];

      if (patternPart.startsWith('{') && patternPart.endsWith('}')) {
        const paramName = patternPart.slice(1, -1);
        params[paramName] = decodeURIComponent(actualPart);
      } else if (patternPart !== actualPart) {
        return null;
      }
    }

    return params;
  }

  private generateMockResponse(request: MockRequest, match: RouteMatch): MockResponse {
    const { endpoint } = match;

    const statusCode = this.selectResponseStatus(endpoint);
    const response = endpoint.responses[statusCode];

    if (!response?.content) {
      return {
        status: parseInt(statusCode),
        headers: { 'Content-Type': 'application/json' },
        body: {},
      };
    }

    const contentType = Object.keys(response.content)[0] || 'application/json';
    const mediaTypeObj = response.content[contentType];
    const schema = mediaTypeObj?.schema;

    let body: any;

    if (this.isStatefulEndpoint(endpoint)) {
      body = this.handleStatefulRequest(request, match, schema);
    } else {
      body = this.dataGenerator.generate(schema);
    }

    return {
      status: parseInt(statusCode),
      headers: {
        'Content-Type': contentType,
        'X-Mock-Server': 'api-contract-platform',
      },
      body,
    };
  }

  private selectResponseStatus(endpoint: Endpoint): string {
    const statusCodes = Object.keys(endpoint.responses);

    const successStatuses = statusCodes.filter((code) => code.startsWith('2'));
    if (successStatuses.length > 0) {
      if (successStatuses.includes('200')) return '200';
      if (successStatuses.includes('201')) return '201';
      return successStatuses[0];
    }

    return statusCodes[0] || '200';
  }

  private isStatefulEndpoint(endpoint: Endpoint): boolean {
    const path = endpoint.path;
    const resourceMatch = path.match(/^\/([\w-]+)(\/\{[\w-]+\})?$/);
    return !!resourceMatch && ['get', 'post', 'put', 'delete'].includes(endpoint.method);
  }

  private extractResourceName(path: string): string | null {
    const match = path.match(/^\/([\w-]+)(\/|$)/);
    return match ? match[1] : null;
  }

  private handleStatefulRequest(request: MockRequest, match: RouteMatch, responseSchema?: SchemaObject): any {
    const { endpoint, pathParams } = match;
    const resourceName = this.extractResourceName(endpoint.path);

    if (!resourceName) {
      return this.dataGenerator.generate(responseSchema);
    }

    if (!this.state.resources[resourceName]) {
      this.state.resources[resourceName] = {};
      this.state.nextIds[resourceName] = 1;
    }

    const resourceStore = this.state.resources[resourceName];

    switch (endpoint.method) {
      case 'get': {
        const idParam = this.findIdParam(pathParams, endpoint.path);
        if (idParam) {
          const resource = resourceStore[idParam];
          if (resource) {
            return resource;
          }
          return this.generateNotFoundResponse();
        }
        const resources = Object.values(resourceStore);
        if (resources.length === 0) {
          return this.dataGenerator.generate(responseSchema);
        }
        return this.wrapListResponse(resources, responseSchema);
      }

      case 'post': {
        const id = String(this.state.nextIds[resourceName]++);
        const newResource = this.createResource(request.body, responseSchema, id);
        resourceStore[id] = newResource;
        return newResource;
      }

      case 'put': {
        const idParam = this.findIdParam(pathParams, endpoint.path);
        if (idParam) {
          const existing = resourceStore[idParam] || {};
          const updated = { ...existing, ...request.body, id: idParam };
          resourceStore[idParam] = updated;
          return updated;
        }
        return this.dataGenerator.generate(responseSchema);
      }

      case 'delete': {
        const idParam = this.findIdParam(pathParams, endpoint.path);
        if (idParam) {
          delete resourceStore[idParam];
          return { success: true, id: idParam };
        }
        return { success: true, deleted: Object.keys(resourceStore).length };
      }

      default:
        return this.dataGenerator.generate(responseSchema);
    }
  }

  private findIdParam(pathParams: { [key: string]: string }, path: string): string | null {
    const idKeys = Object.keys(pathParams).filter((k) => k.toLowerCase().includes('id'));
    if (idKeys.length > 0) {
      return pathParams[idKeys[0]];
    }

    const pathMatch = path.match(/\{([\w-]+)\}/);
    if (pathMatch) {
      return pathParams[pathMatch[1]] || null;
    }

    return null;
  }

  private createResource(requestBody: any, responseSchema: SchemaObject | undefined, id: string): any {
    if (requestBody && typeof requestBody === 'object') {
      const resource = { ...requestBody };
      if (!resource.id) {
        resource.id = id;
      }
      if (!resource.createdAt) {
        resource.createdAt = new Date().toISOString();
      }
      resource.updatedAt = new Date().toISOString();
      return resource;
    }

    if (responseSchema) {
      const generated = this.dataGenerator.generate(responseSchema);
      if (typeof generated === 'object' && generated !== null) {
        generated.id = id;
        generated.createdAt = new Date().toISOString();
        generated.updatedAt = new Date().toISOString();
        return generated;
      }
      return generated;
    }

    return { id, createdAt: new Date().toISOString() };
  }

  private wrapListResponse(items: any[], responseSchema: SchemaObject | undefined): any {
    if (responseSchema && this.isListSchema(responseSchema)) {
      return items;
    }
    return {
      data: items,
      total: items.length,
      page: 1,
      pageSize: items.length,
    };
  }

  private isListSchema(schema: SchemaObject): boolean {
    return 'type' in schema && schema.type === 'array';
  }

  private generateNotFoundResponse(): any {
    return {
      error: 'Not Found',
      message: 'Resource not found',
    };
  }

  generateExample(endpoint: Endpoint, type: 'request' | 'response' = 'response', statusCode: string = '200'): any {
    if (type === 'request') {
      const requestBody = endpoint.requestBody;
      if (!requestBody?.content) return null;

      const contentType = Object.keys(requestBody.content)[0];
      const mediaObj = requestBody.content[contentType];

      if (mediaObj.example) return mediaObj.example;
      if (mediaObj.schema) return this.dataGenerator.generate(mediaObj.schema);
      return null;
    }

    const response = endpoint.responses[statusCode];
    if (!response?.content) return null;

    const contentType = Object.keys(response.content)[0];
    const mediaObj = response.content[contentType];

    if (mediaObj.example) return mediaObj.example;
    if (mediaObj.schema) return this.dataGenerator.generate(mediaObj.schema);
    return null;
  }

  generateAllExamples(): { [key: string]: any } {
    const examples: { [key: string]: any } = {};

    for (const endpoint of this.apiModel.endpoints) {
      const key = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
      examples[key] = {
        request: this.generateExample(endpoint, 'request'),
        responses: {} as { [statusCode: string]: any },
      };

      for (const statusCode of Object.keys(endpoint.responses)) {
        examples[key].responses[statusCode] = this.generateExample(endpoint, 'response', statusCode);
      }
    }

    return examples;
  }
}

export function createMockEngine(apiModel: ApiModel, parser: OpenAPIParser): MockEngine {
  return new MockEngine(apiModel, parser);
}

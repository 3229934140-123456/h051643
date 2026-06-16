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

  exportState(options?: {
    format?: 'json' | 'object';
    pretty?: boolean;
    includeMeta?: boolean;
  }): string | MockStateExport {
    const opts = { format: 'json' as const, pretty: true, includeMeta: true, ...options };

    const exportData: MockStateExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      resources: JSON.parse(JSON.stringify(this.state.resources)),
      nextIds: JSON.parse(JSON.stringify(this.state.nextIds)),
    };

    if (opts.includeMeta) {
      exportData.meta = {
        resourceCount: Object.keys(exportData.resources).reduce(
          (sum, k) => sum + Object.keys(exportData.resources[k]).length,
          0,
        ),
        resourceTypes: Object.keys(exportData.resources),
      };
    }

    if (opts.format === 'object') {
      return exportData;
    }

    return opts.pretty ? JSON.stringify(exportData, null, 2) : JSON.stringify(exportData);
  }

  importState(data: string | MockStateExport, options?: {
    mode?: 'replace' | 'merge';
    resetBeforeImport?: boolean;
    validateIds?: boolean;
  }): { imported: number; warnings: string[] } {
    const opts = {
      mode: 'replace' as 'replace' | 'merge',
      resetBeforeImport: true,
      validateIds: true,
      ...options,
    };

    const warnings: string[] = [];

    let parsed: MockStateExport;
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        throw new Error(`Failed to parse import data: ${(e as Error).message}`);
      }
    } else {
      parsed = data;
    }

    if (parsed.version !== 1) {
      warnings.push(`Unsupported export version: ${parsed.version}, trying anyway`);
    }

    if (opts.resetBeforeImport) {
      this.resetState();
    }

    if (opts.mode === 'replace') {
      this.state.resources = JSON.parse(JSON.stringify(parsed.resources || {}));
      this.state.nextIds = JSON.parse(JSON.stringify(parsed.nextIds || {}));
    } else {
      for (const [resourceType, items] of Object.entries(parsed.resources || {})) {
        if (!this.state.resources[resourceType]) {
          this.state.resources[resourceType] = {};
        }
        for (const [id, item] of Object.entries(items)) {
          if (opts.validateIds && id in this.state.resources[resourceType]) {
            warnings.push(`Overwriting existing ${resourceType} with id=${id}`);
          }
          this.state.resources[resourceType][id] = JSON.parse(JSON.stringify(item));
        }
      }
      for (const [resourceType, nextId] of Object.entries(parsed.nextIds || {})) {
        const existing = this.state.nextIds[resourceType] || 1;
        this.state.nextIds[resourceType] = Math.max(existing, nextId as number);
      }
    }

    const imported = Object.keys(parsed.resources || {}).reduce(
      (sum, k) => sum + Object.keys(parsed.resources[k]).length,
      0,
    );

    return { imported, warnings };
  }

  loadFixture(fixture: MockFixture): { loaded: number; warnings: string[] } {
    const warnings: string[] = [];
    let loaded = 0;

    if (fixture.resetBeforeLoad ?? true) {
      this.resetState();
    }

    for (const [resourceType, items] of Object.entries(fixture.resources || {})) {
      if (!this.state.resources[resourceType]) {
        this.state.resources[resourceType] = {};
        this.state.nextIds[resourceType] = 1;
      }

      for (const item of items) {
        const resource = { ...item };
        let id = resource.id;

        if (!id) {
          id = String(this.state.nextIds[resourceType]++);
          resource.id = id;
        } else {
          const idNum = parseInt(id);
          if (!isNaN(idNum) && idNum >= (this.state.nextIds[resourceType] || 0)) {
            this.state.nextIds[resourceType] = idNum + 1;
          }
        }

        if (!resource.createdAt) {
          resource.createdAt = fixture.fixedTime || new Date().toISOString();
        }
        if (!resource.updatedAt) {
          resource.updatedAt = fixture.fixedTime || new Date().toISOString();
        }

        if (id in this.state.resources[resourceType]) {
          warnings.push(`Overwriting ${resourceType} id=${id}`);
        }
        this.state.resources[resourceType][id] = resource;
        loaded++;
      }
    }

    if (fixture.nextIds) {
      for (const [type, id] of Object.entries(fixture.nextIds)) {
        const existing = this.state.nextIds[type] || 1;
        this.state.nextIds[type] = Math.max(existing, id as number);
      }
    }

    return { loaded, warnings };
  }

  generateFixture(options: {
    resourceTypes: string[];
    counts: { [resourceType: string]: number };
    fixedTime?: string;
    overrides?: { [resourceType: string]: (item: any, index: number) => any };
  }): MockFixture {
    const fixture: MockFixture = {
      name: options.resourceTypes.join('-'),
      createdAt: new Date().toISOString(),
      fixedTime: options.fixedTime,
      resources: {},
      nextIds: {},
    };

    for (const type of options.resourceTypes) {
      const count = options.counts[type] || 0;
      fixture.resources![type] = [];

      const endpoint = this.findPostEndpointForResource(type);
      const responseSchema = endpoint
        ? this.parser.getResponseSchema(endpoint, '201') || this.parser.getResponseSchema(endpoint, '200')
        : undefined;
      const typeSchema = this.apiModel.schemas[this.capitalize(type)];
      const schema = responseSchema || typeSchema;

      for (let i = 0; i < count; i++) {
        let item: any;
        if (schema) {
          item = this.dataGenerator.generate(schema);
          if (item && typeof item === 'object' && item.data && Array.isArray(item.data) && item.data.length > 0) {
            item = item.data[0];
          }
        } else {
          item = { id: `${i + 1}` };
        }

        if (options.overrides && options.overrides[type]) {
          item = options.overrides[type](item, i);
        }

        delete item.id;

        if (fixture.fixedTime) {
          item.createdAt = fixture.fixedTime;
          item.updatedAt = fixture.fixedTime;
        }

        fixture.resources![type].push(item);
      }
      fixture.nextIds![type] = count + 1;
    }

    return fixture;
  }

  saveFixtureToFile(fixture: MockFixture, filePath: string): void {
    const fs = require('fs');
    const path = require('path');
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2), 'utf-8');
  }

  loadFixtureFromFile(filePath: string): MockFixture {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }

  saveStateToFile(filePath: string, options?: Parameters<MockEngine['exportState']>[0]): void {
    const data = this.exportState(options);
    const fs = require('fs');
    const path = require('path');
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, data, 'utf-8');
  }

  loadStateFromFile(filePath: string, options?: Parameters<MockEngine['importState']>[1]): { imported: number; warnings: string[] } {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.importState(content, options);
  }

  getResourceSnapshot(resourceType?: string): any {
    if (resourceType) {
      return JSON.parse(JSON.stringify(this.state.resources[resourceType] || {}));
    }
    return JSON.parse(JSON.stringify(this.state.resources));
  }

  getResourceIds(resourceType: string): string[] {
    return Object.keys(this.state.resources[resourceType] || {});
  }

  getResourceCount(resourceType?: string): number {
    if (resourceType) {
      return Object.keys(this.state.resources[resourceType] || {}).length;
    }
    return Object.keys(this.state.resources).reduce(
      (sum, k) => sum + Object.keys(this.state.resources[k]).length,
      0,
    );
  }

  private findPostEndpointForResource(resourceType: string): Endpoint | undefined {
    const pluralType = resourceType.endsWith('s') ? resourceType : `${resourceType}s`;
    const singularType = resourceType.endsWith('s') ? resourceType.slice(0, -1) : resourceType;

    return this.apiModel.endpoints.find((ep) => {
      if (ep.method !== 'post') return false;
      const cleanPath = ep.path.toLowerCase().replace(/\/$/, '');
      return (
        cleanPath === `/${pluralType.toLowerCase()}` ||
        cleanPath === `/${singularType.toLowerCase()}` ||
        cleanPath.endsWith(`/${pluralType.toLowerCase()}`)
      );
    });
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

export interface MockStateExport {
  version: number;
  exportedAt: string;
  resources: { [resourceType: string]: { [id: string]: any } };
  nextIds: { [resourceType: string]: number };
  meta?: {
    resourceCount: number;
    resourceTypes: string[];
  };
}

export interface MockFixture {
  name?: string;
  description?: string;
  createdAt?: string;
  fixedTime?: string;
  resetBeforeLoad?: boolean;
  resources?: { [resourceType: string]: any[] };
  nextIds?: { [resourceType: string]: number };
}

export function createMockEngine(apiModel: ApiModel, parser: OpenAPIParser): MockEngine {
  return new MockEngine(apiModel, parser);
}

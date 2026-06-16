import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenAPIParser,
  parseOpenAPI,
  MockEngine,
  createMockEngine,
  ContractValidator,
  SchemaValidator,
  validateAgainstSchema,
  CompatibilityChecker,
  checkCompatibility,
  SchemaDataGenerator,
} from '../index';
import { sampleSpecV1, sampleSpecV2, breakingChangeSpec } from '../samples/sample-spec';
import { HttpMethod, MockRequest, MockResponse } from '../types';

describe('OpenAPI Parser', () => {
  it('should parse OpenAPI spec into ApiModel', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();

    assert.equal(apiModel.info.title, '用户管理 API');
    assert.equal(apiModel.info.version, '1.0.0');
    assert.equal(apiModel.servers.length, 1);
    assert.equal(apiModel.tags.length, 2);
    assert.ok(Object.keys(apiModel.schemas).length > 0);
  });

  it('should parse all endpoints correctly', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();

    assert.ok(apiModel.endpoints.length >= 6);

    const getUserEndpoint = apiModel.endpoints.find(
      (ep) => ep.path === '/users' && ep.method === 'get',
    );
    assert.ok(getUserEndpoint);
    assert.equal(getUserEndpoint?.operationId, 'getUsers');
    assert.equal(getUserEndpoint?.parameters.length, 3);
  });

  it('should resolve $ref references', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();

    const userSchema = apiModel.schemas['User'];
    assert.ok(userSchema);
    assert.equal((userSchema as any).type, 'object');
    assert.ok((userSchema as any).properties?.id);
  });

  it('should find endpoint by path and method', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const endpoint = parser.findEndpoint('/users', 'get');
    assert.ok(endpoint);
    assert.equal(endpoint?.method, 'get');
  });

  it('should get response schema', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();

    const createUser = apiModel.endpoints.find(
      (ep) => ep.path === '/users' && ep.method === 'post',
    );
    assert.ok(createUser);

    const responseSchema = parser.getResponseSchema(createUser!, '201');
    assert.ok(responseSchema);
  });

  it('should get request schema', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();

    const createUser = apiModel.endpoints.find(
      (ep) => ep.path === '/users' && ep.method === 'post',
    );
    assert.ok(createUser);

    const requestSchema = parser.getRequestSchema(createUser!);
    assert.ok(requestSchema);
  });
});

describe('Schema Data Generator', () => {
  it('should generate data for object schema', () => {
    const generator = new SchemaDataGenerator(42);
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        age: { type: 'integer' as const },
        active: { type: 'boolean' as const },
      },
      required: ['name', 'age'],
    };

    const data = generator.generate(schema);
    assert.equal(typeof data, 'object');
    assert.notEqual(data, null);
    assert.equal(typeof data.name, 'string');
    assert.equal(typeof data.age, 'number');
  });

  it('should generate data for array schema', () => {
    const generator = new SchemaDataGenerator(42);
    const schema = {
      type: 'array' as const,
      items: { type: 'string' as const },
      minItems: 2,
      maxItems: 5,
    };

    const data = generator.generate(schema);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 2);
    assert.ok(data.length <= 5);
  });

  it('should respect enum values', () => {
    const generator = new SchemaDataGenerator(42);
    const schema = {
      type: 'string' as const,
      enum: ['active', 'inactive', 'pending'],
    };

    const data = generator.generate(schema);
    assert.ok(['active', 'inactive', 'pending'].includes(data));
  });

  it('should generate formatted strings', () => {
    const generator = new SchemaDataGenerator(42);

    const emailSchema = { type: 'string' as const, format: 'email' as const };
    const email = generator.generate(emailSchema);
    assert.ok(email.includes('@'));

    const uuidSchema = { type: 'string' as const, format: 'uuid' as const };
    const uuid = generator.generate(uuidSchema);
    assert.ok(uuid.length === 36);
  });

  it('should use example value if provided', () => {
    const generator = new SchemaDataGenerator(42);
    const schema = {
      type: 'string' as const,
      example: 'example-value',
    };

    const data = generator.generate(schema);
    assert.equal(data, 'example-value');
  });
});

describe('Mock Engine', () => {
  let parser: OpenAPIParser;
  let mockEngine: MockEngine;

  beforeEach(() => {
    parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();
    mockEngine = new MockEngine(apiModel, parser, 42);
  });

  it('should return 404 for unknown routes', () => {
    const request: MockRequest = {
      path: '/unknown',
      method: 'get' as HttpMethod,
    };

    const response = mockEngine.handleRequest(request);
    assert.equal(response.status, 404);
  });

  it('should generate mock response for GET /users', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'get' as HttpMethod,
    };

    const response = mockEngine.handleRequest(request);
    assert.equal(response.status, 200);
    assert.ok(response.body.data);
    assert.ok(Array.isArray(response.body.data));
    assert.equal(typeof response.body.total, 'number');
  });

  it('should generate mock response for POST /users', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'post' as HttpMethod,
      body: { name: 'Test User', email: 'test@example.com' },
    };

    const response = mockEngine.handleRequest(request);
    assert.equal(response.status, 201);
    assert.ok(response.body.id);
    assert.equal(response.body.name, 'Test User');
  });

  it('should support stateful mock - create and get user', () => {
    mockEngine.resetState();

    const createRequest: MockRequest = {
      path: '/users',
      method: 'post' as HttpMethod,
      body: { name: 'Alice', email: 'alice@example.com' },
    };
    const createResponse = mockEngine.handleRequest(createRequest);
    const userId = createResponse.body.id;
    assert.ok(userId);

    const getRequest: MockRequest = {
      path: `/users/${userId}`,
      method: 'get' as HttpMethod,
    };
    const getResponse = mockEngine.handleRequest(getRequest);
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.body.name, 'Alice');
  });

  it('should support stateful mock - update user', () => {
    mockEngine.resetState();

    const createRequest: MockRequest = {
      path: '/users',
      method: 'post' as HttpMethod,
      body: { name: 'Bob', email: 'bob@example.com' },
    };
    const createResponse = mockEngine.handleRequest(createRequest);
    const userId = createResponse.body.id;

    const updateRequest: MockRequest = {
      path: `/users/${userId}`,
      method: 'put' as HttpMethod,
      body: { name: 'Bobby', status: 'active' },
    };
    const updateResponse = mockEngine.handleRequest(updateRequest);
    assert.equal(updateResponse.body.name, 'Bobby');
    assert.equal(updateResponse.body.status, 'active');
  });

  it('should support stateful mock - delete user', () => {
    mockEngine.resetState();

    const createRequest: MockRequest = {
      path: '/users',
      method: 'post' as HttpMethod,
      body: { name: 'Charlie', email: 'charlie@example.com' },
    };
    const createResponse = mockEngine.handleRequest(createRequest);
    const userId = createResponse.body.id;

    const deleteRequest: MockRequest = {
      path: `/users/${userId}`,
      method: 'delete' as HttpMethod,
    };
    const deleteResponse = mockEngine.handleRequest(deleteRequest);
    assert.equal(deleteResponse.body.success, true);
    assert.equal(deleteResponse.body.id, userId);
  });

  it('should generate all examples', () => {
    const examples = mockEngine.generateAllExamples();
    assert.ok(Object.keys(examples).length > 0);
  });

  it('should support custom handlers', () => {
    mockEngine.setCustomHandler('GET', '/users', () => ({
      status: 200,
      headers: {},
      body: { custom: true, data: [] },
    }));

    const request: MockRequest = {
      path: '/users',
      method: 'get' as HttpMethod,
    };

    const response = mockEngine.handleRequest(request);
    assert.equal(response.body.custom, true);
  });
});

describe('Schema Validator', () => {
  it('should validate object schema', () => {
    const validator = new SchemaValidator();
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        age: { type: 'integer' as const },
      },
      required: ['name'],
    };

    const validResult = validator.validate({ name: 'Test', age: 25 }, schema);
    assert.equal(validResult.valid, true);

    const invalidResult = validator.validate({ age: 'not-a-number' }, schema);
    assert.equal(invalidResult.valid, false);
    assert.ok(invalidResult.errors.length > 0);
  });

  it('should validate required fields', () => {
    const validator = new SchemaValidator();
    const schema = {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        email: { type: 'string' as const },
      },
      required: ['name', 'email'],
    };

    const result = validator.validate({ name: 'Test' }, schema);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes('email')));
  });

  it('should validate array schema', () => {
    const validator = new SchemaValidator();
    const schema = {
      type: 'array' as const,
      items: { type: 'string' as const },
      minItems: 2,
    };

    const validResult = validator.validate(['a', 'b', 'c'], schema);
    assert.equal(validResult.valid, true);

    const invalidResult = validator.validate(['a'], schema);
    assert.equal(invalidResult.valid, false);
  });

  it('should validate string formats', () => {
    const validator = new SchemaValidator();

    const emailSchema = { type: 'string' as const, format: 'email' as const };
    assert.equal(validator.validate('test@example.com', emailSchema).valid, true);
    assert.equal(validator.validate('not-an-email', emailSchema).valid, false);

    const uuidSchema = { type: 'string' as const, format: 'uuid' as const };
    assert.equal(
      validator.validate('123e4567-e89b-12d3-a456-426614174000', uuidSchema).valid,
      true,
    );
  });

  it('should validate number constraints', () => {
    const validator = new SchemaValidator();
    const schema = {
      type: 'integer' as const,
      minimum: 1,
      maximum: 100,
    };

    assert.equal(validator.validate(50, schema).valid, true);
    assert.equal(validator.validate(0, schema).valid, false);
    assert.equal(validator.validate(101, schema).valid, false);
  });

  it('should validate enum values', () => {
    const validator = new SchemaValidator();
    const schema = {
      type: 'string' as const,
      enum: ['active', 'inactive', 'pending'],
    };

    assert.equal(validator.validate('active', schema).valid, true);
    assert.equal(validator.validate('deleted', schema).valid, false);
  });

  it('should validate allOf schema', () => {
    const validator = new SchemaValidator();
    const schema: any = {
      allOf: [
        { type: 'object' as const, properties: { name: { type: 'string' as const } }, required: ['name'] },
        { type: 'object' as const, properties: { age: { type: 'integer' as const } }, required: ['age'] },
      ],
    };

    assert.equal(validator.validate({ name: 'Test', age: 25 }, schema).valid, true);
    assert.equal(validator.validate({ name: 'Test' }, schema).valid, false);
  });

  it('should validate nested objects', () => {
    const validator = new SchemaValidator();
    const schema = {
      type: 'object' as const,
      properties: {
        user: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const },
            profile: {
              type: 'object' as const,
              properties: {
                age: { type: 'integer' as const },
              },
            },
          },
          required: ['name'],
        },
      },
      required: ['user'],
    };

    const validData = { user: { name: 'Test', profile: { age: 25 } } };
    assert.equal(validator.validate(validData, schema).valid, true);

    const invalidData = { user: { profile: { age: 'invalid' } } };
    const result = validator.validate(invalidData, schema);
    assert.equal(result.valid, false);
  });
});

describe('Contract Validator', () => {
  let parser: OpenAPIParser;
  let validator: ContractValidator;

  beforeEach(() => {
    parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();
    validator = new ContractValidator(apiModel, parser);
  });

  it('should validate valid response', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'Test User',
            email: 'test@example.com',
            status: 'active',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      },
    };

    const result = validator.validateEndpoint('/users', 'get', request, response);
    assert.equal(result.valid, true);
    assert.equal(result.responseErrors.length, 0);
  });

  it('should detect invalid response type', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        data: 'not-an-array',
        total: 1,
        page: 1,
        pageSize: 10,
      },
    };

    const result = validator.validateEndpoint('/users', 'get', request, response);
    assert.equal(result.valid, false);
    assert.ok(result.responseErrors.length > 0);
  });

  it('should detect missing required fields', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        data: [
          {
            id: '123',
            name: 'Test User',
          },
        ],
      },
    };

    const result = validator.validateEndpoint('/users', 'get', request, response);
    assert.equal(result.valid, false);
  });

  it('should validate request body', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'post' as HttpMethod,
      body: { name: 'Test', email: 'invalid-email' },
    };
    const response: MockResponse = {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: '123',
        name: 'Test',
        email: 'invalid-email@example.com',
        status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    };

    const result = validator.validateEndpoint('/users', 'post', request, response);
    assert.equal(result.valid, false);
    assert.ok(result.requestErrors.length > 0);
  });

  it('should detect unexpected status code', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'server error' },
    };

    const result = validator.validateEndpoint('/users', 'get', request, response);
    assert.equal(result.valid, false);
    assert.equal(result.statusCodeMatched, false);
  });

  it('should run multiple contract tests', () => {
    const testCases = [
      {
        path: '/users',
        method: 'get' as HttpMethod,
        request: { path: '/users', method: 'get' as HttpMethod },
        response: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { data: [], total: 0, page: 1, pageSize: 10 },
        },
      },
      {
        path: '/users/123',
        method: 'get' as HttpMethod,
        request: { path: '/users/123', method: 'get' as HttpMethod },
        response: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            id: '123',
            name: 'Test',
            email: 'test@example.com',
            status: 'active',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        },
      },
    ];

    const results = validator.runContractTest(testCases);
    assert.equal(results.length, 2);
  });

  it('should validate endpoint with path parameters correctly', () => {
    const request: MockRequest = {
      path: '/users/550e8400-e29b-41d4-a716-446655440000',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test User',
        email: 'test@example.com',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    };

    const result = validator.validateEndpoint(
      '/users/550e8400-e29b-41d4-a716-446655440000',
      'get',
      request,
      response,
    );
    assert.equal(result.valid, true);
    assert.equal(result.requestErrors.length, 0);
    assert.equal(result.responseErrors.length, 0);
  });

  it('should validate path parameter value against schema', () => {
    const request: MockRequest = {
      path: '/users/not-a-valid-uuid',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: 'not-a-valid-uuid',
        name: 'Test User',
        email: 'test@example.com',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    };

    const result = validator.validateEndpoint(
      '/users/not-a-valid-uuid',
      'get',
      request,
      response,
    );
    assert.equal(result.valid, false);
    assert.ok(result.requestErrors.length > 0);
    assert.ok(
      result.requestErrors.some((e) =>
        e.message.includes('uuid') || e.path.includes('userId'),
      ),
    );
  });

  it('should report error when response body is null but JSON schema is defined', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: null,
    };

    const result = validator.validateEndpoint('/users', 'get', request, response);
    assert.equal(result.valid, false);
    assert.ok(result.responseErrors.length > 0);
    assert.ok(
      result.responseErrors.some((e) =>
        e.message.includes('empty') || e.message.includes('null'),
      ),
    );
  });

  it('should report error when response body is undefined but JSON schema is defined', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    };

    const result = validator.validateEndpoint('/users', 'get', request, response);
    assert.equal(result.valid, false);
    assert.ok(result.responseErrors.length > 0);
    assert.ok(
      result.responseErrors.some((e) => e.message.includes('empty')),
    );
  });

  it('should report all missing required fields clearly', () => {
    const request: MockRequest = {
      path: '/users',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        data: [
          {
            name: 'Only Name',
          },
        ],
      },
    };

    const result = validator.validateEndpoint('/users', 'get', request, response);
    assert.equal(result.valid, false);
    const missingFields = result.responseErrors
      .filter((e) => e.message.includes('Required property'))
      .map((e) => e.path);
    assert.ok(missingFields.length >= 5);
    assert.ok(missingFields.some((p) => p.includes('total')));
    assert.ok(missingFields.some((p) => p.includes('page')));
    assert.ok(missingFields.some((p) => p.includes('pageSize')));
    assert.ok(missingFields.some((p) => p.includes('email')));
    assert.ok(missingFields.some((p) => p.includes('id')));
  });

  it('should report wrong status code clearly', () => {
    const request: MockRequest = {
      path: '/users/123',
      method: 'get' as HttpMethod,
    };
    const response: MockResponse = {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'service unavailable' },
    };

    const result = validator.validateEndpoint('/users/123', 'get', request, response);
    assert.equal(result.valid, false);
    assert.equal(result.statusCodeMatched, false);
    assert.ok(
      result.responseErrors.some((e) =>
        e.message.includes('Unexpected response status') || e.message.includes('503'),
      ),
    );
  });
});

describe('Compatibility Checker', () => {
  it('should detect compatible changes', () => {
    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(sampleSpecV2);
    const oldModel = parser1.parse();
    const newModel = parser2.parse();

    const checker = new CompatibilityChecker();
    const result = checker.check(oldModel, newModel);

    assert.equal(result.isCompatible, false);
    assert.ok(result.breakingChanges.length > 0);
    assert.ok(result.nonBreakingChanges.length > 0);
  });

  it('should detect removed endpoint as breaking change', () => {
    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(breakingChangeSpec);
    const oldModel = parser1.parse();
    const newModel = parser2.parse();

    const checker = new CompatibilityChecker();
    const result = checker.check(oldModel, newModel);

    const removedEndpoints = result.breakingChanges.filter((c) => c.type === 'removed-endpoint');
    assert.ok(removedEndpoints.length > 0);
  });

  it('should detect type change as breaking change', () => {
    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(breakingChangeSpec);
    const oldModel = parser1.parse();
    const newModel = parser2.parse();

    const checker = new CompatibilityChecker();
    const result = checker.check(oldModel, newModel);

    const typeChanges = result.breakingChanges.filter((c) => c.type === 'changed-type');
    assert.ok(typeChanges.length > 0);
  });

  it('should detect added required parameter as breaking change', () => {
    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(sampleSpecV2);
    const oldModel = parser1.parse();
    const newModel = parser2.parse();

    const checker = new CompatibilityChecker();
    const result = checker.check(oldModel, newModel);

    const addedRequired = result.breakingChanges.filter((c) => c.type === 'added-required');
    assert.ok(addedRequired.length > 0);
  });

  it('should detect removed property as breaking change', () => {
    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(breakingChangeSpec);
    const oldModel = parser1.parse();
    const newModel = parser2.parse();

    const checker = new CompatibilityChecker();
    const result = checker.check(oldModel, newModel);

    const removedProps = result.breakingChanges.filter((c) => c.type === 'removed-property');
    assert.ok(removedProps.length > 0);
  });

  it('should detect added endpoint as non-breaking change', () => {
    const parser1 = new OpenAPIParser(breakingChangeSpec);
    const parser2 = new OpenAPIParser(sampleSpecV1);
    const oldModel = parser1.parse();
    const newModel = parser2.parse();

    const checker = new CompatibilityChecker();
    const result = checker.check(oldModel, newModel);

    const addedEndpoints = result.nonBreakingChanges.filter((c) => c.type === 'added-endpoint');
    assert.ok(addedEndpoints.length > 0);
  });
});

describe('Docs Generator', () => {
  it('should generate HTML documentation', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();

    const { DocsGenerator } = require('../docs-generator');
    const generator = new DocsGenerator(apiModel);
    const html = generator.generateHTML();

    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('用户管理 API'));
    assert.ok(html.includes('/users'));
    assert.ok(html.includes('User'));
  });

  it('should include all endpoints in docs', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();

    const { DocsGenerator } = require('../docs-generator');
    const generator = new DocsGenerator(apiModel);
    const html = generator.generateHTML();

    assert.ok(html.includes('GET'));
    assert.ok(html.includes('POST'));
    assert.ok(html.includes('PUT'));
    assert.ok(html.includes('DELETE'));
  });

  it('should include schemas in docs', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();

    const { DocsGenerator } = require('../docs-generator');
    const generator = new DocsGenerator(apiModel);
    const html = generator.generateHTML();

    assert.ok(html.includes('数据模型'));
    assert.ok(html.includes('User'));
    assert.ok(html.includes('Order'));
    assert.ok(html.includes('Error'));
  });

  it('should include request examples', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();

    const { DocsGenerator } = require('../docs-generator');
    const generator = new DocsGenerator(apiModel);
    const html = generator.generateHTML();

    assert.ok(html.includes('请求示例'));
    assert.ok(html.includes('cURL'));
  });
});

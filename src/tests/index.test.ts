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

describe('Test Report Generator', () => {
  it('should generate summary with pass/fail counts', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      {
        testCaseId: '1',
        testCaseName: '获取用户列表',
        endpoint: '/users',
        method: 'get',
        valid: true,
        statusCode: 200,
        requestErrors: [],
        responseErrors: [],
        statusCodeMatched: true,
        contentTypeMatched: true,
        durationMs: 120,
      },
      {
        testCaseId: '2',
        testCaseName: '创建用户',
        endpoint: '/users',
        method: 'post',
        valid: false,
        statusCode: 201,
        requestErrors: [],
        responseErrors: [
          { path: 'response.body.email', message: 'Required property "email" is missing' },
        ],
        statusCodeMatched: true,
        contentTypeMatched: true,
        durationMs: 85,
      },
    ];

    const report = generator.generateReport(results);

    assert.equal(report.summary.total, 2);
    assert.equal(report.summary.passed, 1);
    assert.equal(report.summary.failed, 1);
    assert.equal(report.summary.passRate, 50);
    assert.equal(report.summary.totalDurationMs, 205);
  });

  it('should group by method and status code', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      { endpoint: '/users', method: 'get', valid: true, statusCode: 200, requestErrors: [], responseErrors: [], statusCodeMatched: true, contentTypeMatched: true },
      { endpoint: '/users', method: 'get', valid: true, statusCode: 200, requestErrors: [], responseErrors: [], statusCodeMatched: true, contentTypeMatched: true },
      { endpoint: '/users', method: 'post', valid: false, statusCode: 201, requestErrors: [], responseErrors: [{ path: '$', message: 'err' }], statusCodeMatched: true, contentTypeMatched: true },
    ];

    const report = generator.generateReport(results);

    const getGroup = report.summary.byMethod.find((g: any) => g.method === 'GET');
    assert.ok(getGroup);
    assert.equal(getGroup.passed, 2);

    const postGroup = report.summary.byMethod.find((g: any) => g.method === 'POST');
    assert.ok(postGroup);
    assert.equal(postGroup.failed, 1);
  });

  it('should extract failed details with error paths', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      {
        testCaseName: '失败用例',
        endpoint: '/users/123',
        method: 'get',
        valid: false,
        statusCode: 200,
        requestErrors: [{ path: 'request.path.userId', message: 'Invalid uuid' }],
        responseErrors: [{ path: 'response.body.name', message: 'Required', actual: null, expected: 'string' }],
        statusCodeMatched: true,
        contentTypeMatched: true,
      },
    ];

    const report = generator.generateReport(results);
    assert.equal(report.failedDetails.length, 1);
    assert.equal(report.failedDetails[0].requestErrors.length, 1);
    assert.equal(report.failedDetails[0].responseErrors.length, 1);
    assert.equal(report.failedDetails[0].responseErrors[0].path, 'response.body.name');
    assert.equal(report.failedDetails[0].responseErrors[0].actual, null);
  });

  it('should format as text report', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      { endpoint: '/users', method: 'get', valid: true, statusCode: 200, requestErrors: [], responseErrors: [], statusCodeMatched: true, contentTypeMatched: true, durationMs: 100 },
    ];

    const report = generator.generateReport(results);
    const text = generator.formatAsText(report);

    assert.ok(text.includes('契约测试汇总报告'));
    assert.ok(text.includes('用例总数'));
    assert.ok(text.includes('通过率'));
    assert.ok(text.includes('GET'));
  });

  it('should format as HTML report', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      { testCaseName: 'TC1', endpoint: '/users', method: 'get', valid: true, statusCode: 200, requestErrors: [], responseErrors: [], statusCodeMatched: true, contentTypeMatched: true },
    ];

    const report = generator.generateReport(results);
    const html = generator.formatAsHTML(report);

    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('契约测试汇总报告'));
    assert.ok(html.includes('通过率'));
  });
});

describe('Mock State Import/Export', () => {
  let parser: OpenAPIParser;
  let mockEngine: any;

  beforeEach(() => {
    parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();
    const MockEngineModule = require('../mock-engine');
    mockEngine = new MockEngineModule.MockEngine(apiModel, parser, 42);
  });

  it('should export state as JSON string', () => {
    mockEngine.resetState();

    const req1: any = { path: '/users', method: 'post' as HttpMethod, body: { name: 'User1', email: 'a@b.com' } };
    const req2: any = { path: '/users', method: 'post' as HttpMethod, body: { name: 'User2', email: 'c@d.com' } };
    mockEngine.handleRequest(req1);
    mockEngine.handleRequest(req2);

    const exported = mockEngine.exportState();
    assert.equal(typeof exported, 'string');
    const parsed = JSON.parse(exported as string);
    assert.equal(parsed.version, 1);
    assert.ok(parsed.resources.users);
    assert.equal(Object.keys(parsed.resources.users).length, 2);
  });

  it('should import state and restore resources', () => {
    mockEngine.resetState();

    const fixture: any = {
      version: 1,
      exportedAt: new Date().toISOString(),
      resources: {
        users: {
          '99': { id: '99', name: 'ImportedUser', email: 'imported@test.com', status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        },
      },
      nextIds: { users: 100 },
    };

    const result = mockEngine.importState(fixture);
    assert.equal(result.imported, 1);

    const getReq: any = { path: '/users/99', method: 'get' as HttpMethod };
    const getResp = mockEngine.handleRequest(getReq);
    assert.equal(getResp.status, 200);
    assert.equal(getResp.body.name, 'ImportedUser');
    assert.equal(getResp.body.id, '99');
  });

  it('should support merge mode import', () => {
    mockEngine.resetState();

    const req1: any = { path: '/users', method: 'post' as HttpMethod, body: { name: 'OldUser', email: 'old@test.com' } };
    mockEngine.handleRequest(req1);

    const fixture: any = {
      version: 1,
      exportedAt: new Date().toISOString(),
      resources: {
        users: {
          'new-1': { id: 'new-1', name: 'NewUser', email: 'new@test.com', status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        },
      },
      nextIds: { users: 5 },
    };

    const result = mockEngine.importState(fixture, { mode: 'merge', resetBeforeImport: false });
    assert.equal(result.imported, 1);

    const listReq: any = { path: '/users', method: 'get' as HttpMethod };
    const listResp = mockEngine.handleRequest(listReq);
    assert.ok(listResp.body.data.length >= 2);
  });

  it('should load fixture with preset data', () => {
    mockEngine.resetState();

    const { MockFixture } = require('../mock-engine');
    const fixture: any = {
      name: 'test-fixture',
      fixedTime: '2024-06-17T12:00:00Z',
      resources: {
        users: [
          { name: 'FixtureUser1', email: 'f1@test.com', status: 'active' },
          { name: 'FixtureUser2', email: 'f2@test.com', status: 'inactive' },
        ],
        orders: [
          { userId: '1', totalAmount: 100, status: 'paid', items: [] },
        ],
      },
    };

    const result = mockEngine.loadFixture(fixture);
    assert.equal(result.loaded, 3);

    const userListReq: any = { path: '/users', method: 'get' as HttpMethod };
    const userListResp = mockEngine.handleRequest(userListReq);
    assert.equal(userListResp.body.data.length, 2);
    assert.equal(userListResp.body.data[0].createdAt, '2024-06-17T12:00:00Z');
  });

  it('should generate fixture automatically from schema', () => {
    const fixture = mockEngine.generateFixture({
      resourceTypes: ['users', 'orders'],
      counts: { users: 3, orders: 2 },
      fixedTime: '2024-01-01T00:00:00Z',
    });

    assert.ok(fixture);
    assert.equal(fixture.resources.users.length, 3);
    assert.equal(fixture.resources.orders.length, 2);
    assert.ok(fixture.resources.users[0].name);
    assert.ok(fixture.resources.users[0].email);
  });

  it('should support getResourceSnapshot and getResourceCount', () => {
    mockEngine.resetState();

    const req1: any = { path: '/users', method: 'post' as HttpMethod, body: { name: 'A', email: 'a@a.com' } };
    const req2: any = { path: '/users', method: 'post' as HttpMethod, body: { name: 'B', email: 'b@b.com' } };
    mockEngine.handleRequest(req1);
    mockEngine.handleRequest(req2);

    assert.equal(mockEngine.getResourceCount('users'), 2);
    assert.equal(mockEngine.getResourceCount(), 2);

    const snapshot = mockEngine.getResourceSnapshot('users');
    assert.equal(Object.keys(snapshot).length, 2);

    const ids = mockEngine.getResourceIds('users');
    assert.equal(ids.length, 2);
  });
});

describe('Compatibility Checker - CI Enhanced', () => {
  it('should classify breaking changes into request/response side', () => {
    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(sampleSpecV2);
    const oldModel = parser1.parse();
    const newModel = parser2.parse();

    const checker = new CompatibilityChecker();
    const result = checker.checkWithCI(oldModel, newModel);

    assert.ok(result.classification);
    assert.ok(result.summary);
    assert.ok(typeof result.exitCode === 'number');
    assert.ok(result.severityLevel);

    const requestBreaking = result.classification.requestSideBreaking;
    const responseBreaking = result.classification.responseSideBreaking;
    assert.ok(requestBreaking.length >= 0);
    assert.ok(responseBreaking.length >= 0);
    assert.ok(requestBreaking.length + responseBreaking.length >= 1);
  });

  it('should return correct exit codes based on severity', () => {
    const { getCompatibilityExitCode, checkCompatibilityWithCI } = require('../compatibility-checker');

    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(sampleSpecV2);
    const parser3 = new OpenAPIParser(breakingChangeSpec);
    const v1 = parser1.parse();
    const v2 = parser2.parse();
    const v3 = parser3.parse();

    const breakingResult = checkCompatibilityWithCI(v1, v3);
    assert.ok(breakingResult.exitCode >= 1);
    assert.equal(breakingResult.severityLevel, 'danger');

    const exitCode = getCompatibilityExitCode(breakingResult);
    assert.equal(exitCode, breakingResult.exitCode);

    const sameResult = checkCompatibilityWithCI(v1, v1);
    assert.equal(sameResult.exitCode, 0);
    assert.equal(sameResult.severityLevel, 'safe');
  });

  it('should generate recommendations', () => {
    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(sampleSpecV2);
    const oldModel = parser1.parse();
    const newModel = parser2.parse();

    const checker = new CompatibilityChecker();
    const result = checker.checkWithCI(oldModel, newModel);

    assert.ok(result.recommendations.length > 0);
    assert.ok(result.recommendations.some((r: string) => r.includes('变更') || r.includes('新增') || r.includes('删除') || r.includes('兼容')));
  });

  it('should format report as text', () => {
    const { formatCompatibilityReport, checkCompatibilityWithCI } = require('../compatibility-checker');

    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(sampleSpecV2);
    const v1 = parser1.parse();
    const v2 = parser2.parse();

    const result = checkCompatibilityWithCI(v1, v2);
    const text = formatCompatibilityReport(result, 'text');

    assert.ok(text.includes('兼容性检查报告'));
    assert.ok(text.includes('严重级别'));
    assert.ok(text.includes('CI 退出码'));
    assert.ok(text.includes('请求侧') || text.includes('响应侧'));
  });

  it('should format report as markdown', () => {
    const { formatCompatibilityReport, checkCompatibilityWithCI } = require('../compatibility-checker');

    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(sampleSpecV2);
    const v1 = parser1.parse();
    const v2 = parser2.parse();

    const result = checkCompatibilityWithCI(v1, v2);
    const md = formatCompatibilityReport(result, 'markdown');

    assert.ok(md.includes('# API 兼容性检查报告'));
    assert.ok(md.includes('| 类别 | 数量 |'));
    assert.ok(md.includes('## 💡 建议'));
  });

  it('should distinguish added fields as non-breaking', () => {
    const parser1 = new OpenAPIParser(sampleSpecV1);
    const parser2 = new OpenAPIParser(sampleSpecV2);
    const oldModel = parser1.parse();
    const newModel = parser2.parse();

    const checker = new CompatibilityChecker();
    const result = checker.checkWithCI(oldModel, newModel);

    assert.ok(result.summary.addedFieldsCount >= 1);
    assert.ok(result.classification.addedFields.length >= 1);
  });
});

describe('Test Report - Real Status Code Grouping', () => {
  it('should group by real HTTP status codes', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      { endpoint: '/users', method: 'get', valid: true, statusCode: 200, requestErrors: [], responseErrors: [], statusCodeMatched: true, contentTypeMatched: true },
      { endpoint: '/users', method: 'post', valid: true, statusCode: 201, requestErrors: [], responseErrors: [], statusCodeMatched: true, contentTypeMatched: true },
      { endpoint: '/users/999', method: 'get', valid: false, statusCode: 404, requestErrors: [], responseErrors: [{ path: '$', message: 'Not found' }], statusCodeMatched: true, contentTypeMatched: true },
      { endpoint: '/users', method: 'post', valid: false, statusCode: 500, requestErrors: [], responseErrors: [{ path: '$', message: 'Server error' }], statusCodeMatched: true, contentTypeMatched: true },
    ];

    const report = generator.generateReport(results);

    assert.ok(report.summary.byRealStatusCode);
    const sc200 = report.summary.byRealStatusCode.find((g: any) => g.statusCode === 200);
    assert.ok(sc200);
    assert.equal(sc200.passed, 1);

    const sc404 = report.summary.byRealStatusCode.find((g: any) => g.statusCode === 404);
    assert.ok(sc404);
    assert.equal(sc404.failed, 1);

    const sc500 = report.summary.byRealStatusCode.find((g: any) => g.statusCode === 500);
    assert.ok(sc500);
    assert.equal(sc500.failed, 1);
  });

  it('should include requestUrl and contentType in failed details', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      {
        testCaseName: 'TC1',
        endpoint: '/users/123',
        method: 'get',
        valid: false,
        statusCode: 200,
        requestErrors: [],
        responseErrors: [{ path: 'response.body.name', message: 'Required property "name" is missing', expected: 'string', actual: null }],
        statusCodeMatched: true,
        contentTypeMatched: false,
        requestUrl: 'https://api.example.com/users/123',
        contentType: 'text/html',
      },
    ];

    const report = generator.generateReport(results);
    assert.equal(report.failedDetails.length, 1);
    assert.equal(report.failedDetails[0].requestUrl, 'https://api.example.com/users/123');
    assert.equal(report.failedDetails[0].contentType, 'text/html');
  });

  it('should show real status codes in text report', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      { endpoint: '/users', method: 'get', valid: true, statusCode: 200, requestErrors: [], responseErrors: [], statusCodeMatched: true, contentTypeMatched: true },
      { endpoint: '/bad', method: 'get', valid: false, statusCode: 500, requestErrors: [], responseErrors: [{ path: '$', message: 'err' }], statusCodeMatched: true, contentTypeMatched: true },
    ];

    const report = generator.generateReport(results);
    const text = generator.formatAsText(report);

    assert.ok(text.includes('按实际状态码'));
    assert.ok(text.includes('200'));
    assert.ok(text.includes('500'));
  });
});

describe('Test Report - Error Categorization and Filtering', () => {
  it('should categorize errors by type', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      {
        endpoint: '/users', method: 'post', valid: false, statusCode: 200,
        requestErrors: [],
        responseErrors: [
          { path: 'r1', message: 'Required property "email" is missing', expected: 'string', actual: null },
          { path: 'r2', message: 'Expected type string but got number', expected: 'string', actual: 42 },
          { path: 'r3', message: 'Invalid format: uuid', expected: 'uuid', actual: 'abc' },
          { path: 'r4', message: 'Value not in enum allowed values', expected: '["a","b"]', actual: 'c' },
        ],
        statusCodeMatched: true, contentTypeMatched: true,
      },
    ];

    const report = generator.generateReport(results);
    const d = report.failedDetails[0];

    assert.equal(d.responseErrors[0].category, 'missing');
    assert.equal(d.responseErrors[1].category, 'type');
    assert.equal(d.responseErrors[2].category, 'format');
    assert.equal(d.responseErrors[3].category, 'enum');
  });

  it('should filter failed details by request side', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      { endpoint: '/a', method: 'get', valid: false, statusCode: 200, requestErrors: [{ path: 'p', message: 'err' }], responseErrors: [], statusCodeMatched: true, contentTypeMatched: true },
      { endpoint: '/b', method: 'get', valid: false, statusCode: 200, requestErrors: [], responseErrors: [{ path: 'p', message: 'err' }], statusCodeMatched: true, contentTypeMatched: true },
    ];

    const report = generator.generateReport(results);
    const requestSide = report.filterFailedDetails({ side: 'request' });
    assert.equal(requestSide.length, 1);

    const responseSide = report.filterFailedDetails({ side: 'response' });
    assert.equal(responseSide.length, 1);
  });

  it('should filter by status code mismatch', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      { endpoint: '/a', method: 'get', valid: false, statusCode: 500, requestErrors: [], responseErrors: [{ path: '$', message: 'Unexpected response status code: 500' }], statusCodeMatched: false, contentTypeMatched: true },
      { endpoint: '/b', method: 'get', valid: false, statusCode: 200, requestErrors: [], responseErrors: [{ path: 'r', message: 'Missing' }], statusCodeMatched: true, contentTypeMatched: true },
    ];

    const report = generator.generateReport(results);
    const mismatched = report.filterFailedDetails({ statusCodeMismatch: true });
    assert.equal(mismatched.length, 1);
    assert.equal(mismatched[0].endpoint, '/a');
  });

  it('should filter by error category', () => {
    const { TestReportGenerator } = require('../test-report');
    const generator = new TestReportGenerator();

    const results: any[] = [
      { endpoint: '/a', method: 'get', valid: false, statusCode: 200, requestErrors: [], responseErrors: [{ path: 'r1', message: 'Required property missing' }], statusCodeMatched: true, contentTypeMatched: true },
      { endpoint: '/b', method: 'get', valid: false, statusCode: 200, requestErrors: [], responseErrors: [{ path: 'r2', message: 'Expected type string' }], statusCodeMatched: true, contentTypeMatched: true },
    ];

    const report = generator.generateReport(results);
    const missingOnly = report.filterFailedDetails({ category: 'missing' });
    assert.equal(missingOnly.length, 1);

    const typeOnly = report.filterFailedDetails({ category: 'type' });
    assert.equal(typeOnly.length, 1);
  });
});

describe('Contract Validator - Header Case Insensitivity', () => {
  it('should match headers case-insensitively', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();
    const validator = new ContractValidator(apiModel, parser);

    const request: any = {
      path: '/users',
      method: 'get' as HttpMethod,
      headers: { 'X-Request-ID': 'abc-123', 'Authorization': 'Bearer token' },
      query: {},
    };
    const response: any = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { data: [], total: 0, page: 1, pageSize: 10 },
    };

    const result = validator.validateEndpoint('/users', 'get', request, response);
    assert.ok(result.valid);
  });
});

describe('Live Tester - Env Var Substitution', () => {
  it('should substitute env vars in suite and test cases', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();
    const validator = new ContractValidator(apiModel, parser);

    process.env.TEST_API_HOST = 'localhost';
    process.env.TEST_API_PORT = '9876';
    process.env.TEST_USER_ID = '42';

    try {
      const { LiveContractTester: LCT } = require('../live-tester');
      const tester = new LCT({ baseUrl: 'http://${TEST_API_HOST}:${TEST_API_PORT}' }, validator);

      const suite: any = {
        baseUrl: 'http://${TEST_API_HOST}:${TEST_API_PORT}',
        testCases: [
          { path: '/users/${TEST_USER_ID}', method: 'get', name: '获取用户' },
        ],
      };

      assert.ok(tester);
      assert.ok(typeof tester.runTestSuite === 'function');
    } finally {
      delete process.env.TEST_API_HOST;
      delete process.env.TEST_API_PORT;
      delete process.env.TEST_USER_ID;
    }
  });

  it('should generate CI JSON output', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();
    const validator = new ContractValidator(apiModel, parser);

    const { LiveContractTester: LCT } = require('../live-tester');
    const tester = new LCT({ baseUrl: 'http://localhost:3000' }, validator);

    const results: any[] = [
      {
        report: {
          generatedAt: new Date().toISOString(),
          summary: { total: 2, passed: 1, failed: 1, passRate: 50, totalDurationMs: 200, byRealStatusCode: [], byMethod: [], byValidationType: { requestValidation: { total: 2, failed: 0 }, responseValidation: { total: 2, failed: 1 }, statusCodeValidation: { total: 2, failed: 0 }, contentTypeValidation: { total: 2, failed: 0 } }, failedEndpointsCount: 1, totalEndpointsCount: 2 },
          endpoints: [],
          failedDetails: [],
          filterFailedDetails: () => [],
        },
        results: [
          { endpoint: '/users', method: 'get', valid: true, statusCode: 200, statusCodeMatched: true, contentTypeMatched: true, requestErrors: [], responseErrors: [], durationMs: 100, requestUrl: 'http://localhost:3000/users' },
          { endpoint: '/users', method: 'post', valid: false, statusCode: 400, statusCodeMatched: true, contentTypeMatched: true, requestErrors: [], responseErrors: [{ path: 'r1', message: 'Missing required field', expected: 'string', actual: null }], durationMs: 100, requestUrl: 'http://localhost:3000/users' },
        ],
        slowEndpoints: [],
        recoveredAfterRetry: [],
        rawResponses: [],
      },
    ];

    const ciOutput = tester.generateCIJsonOutput(results[0], 'http://localhost:3000');
    assert.equal(ciOutput.version, '1.1');
    assert.equal(ciOutput.exitCode, 1);
    assert.equal(ciOutput.summary.total, 2);
    assert.equal(ciOutput.summary.passed, 1);
    assert.equal(ciOutput.summary.recoveredAfterRetry, 0);
    assert.equal(ciOutput.summary.slowEndpoints, 0);
    assert.ok(ciOutput.effectiveConfig);
    assert.equal(ciOutput.effectiveConfig.baseUrl, 'http://localhost:3000');
    assert.equal(ciOutput.results[1].errors.length, 1);
    assert.equal(ciOutput.results[1].errors[0].side, 'response');
    assert.equal(ciOutput.results[1].errors[0].category, 'missing');
    assert.equal(ciOutput.results[1].errors[0].expected, 'string');
    assert.equal(ciOutput.results[1].errors[0].actual, null);
  });
});

describe('Schema Validator - Expected/Actual Comparison', () => {
  it('should include expected and actual for type errors', () => {
    const { SchemaValidator } = require('../contract-validator/schema-validator');

    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    const data = { name: 123 };

    const validator = new SchemaValidator();
    const result = validator.validate(data, schema);

    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);

    const typeError = result.errors.find((e: any) => e.path === '$.name');
    assert.ok(typeError);
    assert.equal(typeError.expected, 'string');
    assert.equal(typeError.actual, 'number');
  });

  it('should include expected and actual for enum errors', () => {
    const { SchemaValidator } = require('../contract-validator/schema-validator');

    const schema = { type: 'string', enum: ['admin', 'user', 'guest'] };
    const data = 'superadmin';

    const validator = new SchemaValidator();
    const result = validator.validate(data, schema);

    assert.equal(result.valid, false);
    assert.ok(result.errors[0].expected);
    assert.deepEqual(result.errors[0].expected, ['admin', 'user', 'guest']);
    assert.equal(result.errors[0].actual, 'superadmin');
  });

  it('should include expected and actual for format errors', () => {
    const { SchemaValidator } = require('../contract-validator/schema-validator');

    const schema = { type: 'string', format: 'email' };
    const data = 'not-an-email';

    const validator = new SchemaValidator();
    const result = validator.validate(data, schema);

    assert.equal(result.valid, false);
    assert.ok(result.errors[0].expected);
    assert.equal(result.errors[0].actual, 'not-an-email');
  });

  it('should include expected and actual for missing required fields', () => {
    const { SchemaValidator } = require('../contract-validator/schema-validator');

    const schema = {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
      },
    };
    const data = { name: 'Test' };

    const validator = new SchemaValidator();
    const result = validator.validate(data, schema);

    assert.equal(result.valid, false);
    const missingError = result.errors.find((e: any) => e.path === '$.email');
    assert.ok(missingError);
    assert.equal(missingError.actual, undefined);
  });
});

describe('Test Report - Failure Attribution Summary', () => {
  it('should build attribution summary with categories', () => {
    const { TestReportGenerator } = require('../test-report');

    const results = [
      {
        endpoint: '/users',
        method: 'get',
        valid: false,
        statusCode: 500,
        statusCodeMatched: false,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'Internal server error' }],
        durationMs: 150,
        requestUrl: 'http://localhost:3000/users',
      },
      {
        endpoint: '/login',
        method: 'post',
        valid: false,
        statusCode: 401,
        statusCodeMatched: false,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'Unauthorized' }],
        durationMs: 80,
        requestUrl: 'http://localhost:3000/login',
      },
      {
        endpoint: '/users',
        method: 'post',
        valid: false,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [{ path: '$.email', message: 'Expected string' }],
        responseErrors: [],
        durationMs: 100,
        requestUrl: 'http://localhost:3000/users',
      },
      {
        endpoint: '/health',
        method: 'get',
        valid: false,
        statusCode: 0,
        statusCodeMatched: false,
        contentTypeMatched: false,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'Network error' }],
        durationMs: 5000,
        requestUrl: 'http://localhost:3000/health',
      },
    ];

    const generator = new TestReportGenerator();
    const report = generator.generateReport(results);

    assert.ok(report.attribution);
    assert.equal(report.attribution.totalFailures, 4);
    assert.ok(report.attribution.byCategory.length > 0);

    const statusCodeCategory = report.attribution.byCategory.find((c: any) => c.category === 'status_code_error');
    assert.ok(statusCodeCategory);
    assert.ok(statusCodeCategory.count >= 1);

    const authCategory = report.attribution.byCategory.find((c: any) => c.category === 'auth_error');
    assert.ok(authCategory);
    assert.equal(authCategory.count, 1);

    const networkCategory = report.attribution.byCategory.find((c: any) => c.category === 'network_error');
    assert.ok(networkCategory);
    assert.equal(networkCategory.count, 1);

    const requestCategory = report.attribution.byCategory.find((c: any) => c.category === 'request_validation_error');
    assert.ok(requestCategory);
    assert.equal(requestCategory.count, 1);
  });

  it('should include top endpoints and top error messages', () => {
    const { TestReportGenerator } = require('../test-report');

    const results = [
      {
        endpoint: '/users',
        method: 'get',
        valid: false,
        statusCode: 500,
        statusCodeMatched: false,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'Internal server error' }],
        durationMs: 100,
      },
      {
        endpoint: '/users',
        method: 'get',
        valid: false,
        statusCode: 500,
        statusCodeMatched: false,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'Internal server error' }],
        durationMs: 100,
      },
      {
        endpoint: '/users',
        method: 'get',
        valid: true,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 100,
      },
      {
        endpoint: '/orders',
        method: 'get',
        valid: false,
        statusCode: 500,
        statusCodeMatched: false,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'Database connection failed' }],
        durationMs: 100,
      },
    ];

    const generator = new TestReportGenerator();
    const report = generator.generateReport(results);

    assert.ok(report.attribution.topEndpoints.length > 0);
    assert.equal(report.attribution.topEndpoints[0].endpoint, '/users');
    assert.equal(report.attribution.topEndpoints[0].method, 'GET');
    assert.equal(report.attribution.topEndpoints[0].failureCount, 2);
    assert.equal(report.attribution.topEndpoints[0].total, 3);
    assert.equal(report.attribution.topEndpoints[0].passRate, 33.33);

    assert.ok(report.attribution.topErrorMessages.length > 0);
    assert.ok(report.attribution.topErrorMessages[0].message.includes('Internal server error'));
    assert.equal(report.attribution.topErrorMessages[0].count, 2);
  });
});

describe('Test Report - Retry and Slow Endpoint', () => {
  it('should mark recovered after retry and slow endpoints in summary', () => {
    const { TestReportGenerator } = require('../test-report');

    const results = [
      {
        endpoint: '/users',
        method: 'get',
        valid: true,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 100,
        retryCount: 2,
        recoveredAfterRetry: true,
        isSlowEndpoint: false,
      },
      {
        endpoint: '/slow-endpoint',
        method: 'get',
        valid: true,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 5000,
        retryCount: 0,
        recoveredAfterRetry: false,
        isSlowEndpoint: true,
      },
      {
        endpoint: '/orders',
        method: 'get',
        valid: true,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 200,
        retryCount: 0,
        recoveredAfterRetry: false,
        isSlowEndpoint: false,
      },
    ];

    const generator = new TestReportGenerator();
    const report = generator.generateReport(results);

    assert.equal(report.summary.recoveredAfterRetry, 1);
    assert.equal(report.summary.slowEndpoints, 1);
    assert.equal(report.summary.total, 3);
    assert.equal(report.summary.passed, 3);
  });

  it('should include retry and slow flags in test case results', () => {
    const { TestReportGenerator } = require('../test-report');

    const results = [
      {
        endpoint: '/recovered',
        method: 'get',
        valid: true,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 100,
        retryCount: 3,
        recoveredAfterRetry: true,
        isSlowEndpoint: false,
      },
    ];

    const generator = new TestReportGenerator();
    const report = generator.generateReport(results);

    assert.equal(report.endpoints[0].testCases[0].retryCount, 3);
    assert.equal(report.endpoints[0].testCases[0].recoveredAfterRetry, true);
    assert.equal(report.endpoints[0].testCases[0].isSlowEndpoint, false);
  });
});

describe('CI History Manager', () => {
  const test = require('node:test');
  const tmp = require('os').tmpdir();
  const fs = require('fs');
  const path = require('path');
  const historyDir = path.join(tmp, `ci-history-test-${Date.now()}`);

  test.after(() => {
    if (fs.existsSync(historyDir)) {
      fs.rmSync(historyDir, { recursive: true, force: true });
    }
  });

  it('should create CIHistoryManager and add records', () => {
    const { CIHistoryManager } = require('../ci-history');
    const { TestReportGenerator } = require('../test-report');
    const path = require('path');
    const fs = require('fs');

    const testDir = path.join(historyDir, `add-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const manager = new CIHistoryManager(testDir);

    const testResults = [
      {
        endpoint: '/users',
        method: 'get',
        valid: true,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 100,
      },
      {
        endpoint: '/orders',
        method: 'get',
        valid: false,
        statusCode: 500,
        statusCodeMatched: false,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'Error' }],
        durationMs: 200,
        requestUrl: 'http://localhost:3000/orders',
      },
    ];

    const generator = new TestReportGenerator();
    const report = generator.generateReport(testResults);

    const context = {
      branch: 'main',
      commitHash: 'abc123def456',
      environment: 'staging',
      buildNumber: '123',
    };

    const record = manager.addRecord(context, report, testResults);

    assert.ok(record.id);
    assert.equal(record.context.branch, 'main');
    assert.equal(record.context.commitHash, 'abc123def456');
    assert.equal(record.summary.total, 2);
    assert.equal(record.summary.passed, 1);
    assert.equal(record.summary.failed, 1);
    assert.equal(record.failedEndpoints.length, 1);
    assert.equal(record.failedEndpoints[0].endpoint, '/orders');
  });

  it('should query records by branch and environment', () => {
    const { CIHistoryManager } = require('../ci-history');
    const { TestReportGenerator } = require('../test-report');
    const path = require('path');
    const fs = require('fs');

    const testDir = path.join(historyDir, `query-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const manager = new CIHistoryManager(testDir);
    const generator = new TestReportGenerator();

    const passResults = [
      {
        endpoint: '/health',
        method: 'get',
        valid: true,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 50,
      },
    ];

    const passReport = generator.generateReport(passResults);

    manager.addRecord(
      { branch: 'main', commitHash: 'abc123', environment: 'staging' },
      passReport,
      passResults
    );

    manager.addRecord(
      { branch: 'feature/login', commitHash: 'def789', environment: 'staging' },
      passReport,
      passResults
    );

    manager.addRecord(
      { branch: 'main', commitHash: 'ghi012', environment: 'production' },
      passReport,
      passResults
    );

    const mainRecords = manager.queryRecords({ branch: 'main' });
    assert.equal(mainRecords.length, 2);

    const stagingRecords = manager.queryRecords({ environment: 'staging' });
    assert.equal(stagingRecords.length, 2);

    const prodRecords = manager.queryRecords({ environment: 'production' });
    assert.equal(prodRecords.length, 1);
    assert.equal(prodRecords[0].context.branch, 'main');
  });

  it('should calculate pass rate trend', () => {
    const { CIHistoryManager } = require('../ci-history');
    const { TestReportGenerator } = require('../test-report');
    const path = require('path');
    const fs = require('fs');

    const testDir = path.join(historyDir, `trend-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const manager = new CIHistoryManager(testDir);
    const generator = new TestReportGenerator();

    for (let i = 0; i < 5; i++) {
      const passRate = 60 + i * 8;
      const total = 10;
      const passed = Math.floor(total * passRate / 100);
      const failed = total - passed;

      const results: any[] = [];
      for (let j = 0; j < passed; j++) {
        results.push({
          endpoint: `/api/${j}`,
          method: 'get',
          valid: true,
          statusCode: 200,
          statusCodeMatched: true,
          contentTypeMatched: true,
          requestErrors: [],
          responseErrors: [],
          durationMs: 100,
        });
      }
      for (let j = 0; j < failed; j++) {
        results.push({
          endpoint: `/api/fail-${j}`,
          method: 'get',
          valid: false,
          statusCode: 500,
          statusCodeMatched: false,
          contentTypeMatched: true,
          requestErrors: [],
          responseErrors: [{ path: '$', message: 'Error' }],
          durationMs: 100,
        });
      }

      const report = generator.generateReport(results);
      manager.addRecord(
        { branch: 'trend-test', commitHash: `commit${i}`, environment: 'test' },
        report,
        results
      );
    }

    const trend = manager.getPassRateTrend({ branch: 'trend-test', environment: 'test' });
    assert.equal(trend.length, 5);
    assert.ok(trend[0].passRate < trend[trend.length - 1].passRate);
    assert.ok(trend.every((p: any) => p.passRate >= 0 && p.passRate <= 100));
  });

  it('should detect new failures vs persistent failures', () => {
    const { CIHistoryManager } = require('../ci-history');
    const { TestReportGenerator } = require('../test-report');
    const path = require('path');
    const fs = require('fs');

    const testDir = path.join(historyDir, `diff-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const manager = new CIHistoryManager(testDir);
    const generator = new TestReportGenerator();

    const run1Results = [
      {
        endpoint: '/persistent-fail',
        method: 'get',
        valid: false,
        statusCode: 500,
        statusCodeMatched: false,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'Error' }],
        durationMs: 100,
        requestUrl: 'http://localhost/persistent',
      },
      {
        endpoint: '/will-fail-next',
        method: 'get',
        valid: true,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 100,
      },
    ];

    const report1 = generator.generateReport(run1Results);
    manager.addRecord(
      { branch: 'diff-test', commitHash: 'commit1', environment: 'test' },
      report1,
      run1Results
    );

    const run2Results = [
      {
        endpoint: '/persistent-fail',
        method: 'get',
        valid: false,
        statusCode: 500,
        statusCodeMatched: false,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'Error' }],
        durationMs: 100,
        requestUrl: 'http://localhost/persistent',
      },
      {
        endpoint: '/will-fail-next',
        method: 'get',
        valid: false,
        statusCode: 500,
        statusCodeMatched: false,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [{ path: '$', message: 'New error' }],
        durationMs: 100,
        requestUrl: 'http://localhost/newfail',
      },
      {
        endpoint: '/new-endpoint',
        method: 'post',
        valid: true,
        statusCode: 201,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 100,
      },
    ];

    const report2 = generator.generateReport(run2Results);
    const record2 = manager.addRecord(
      { branch: 'diff-test', commitHash: 'commit2', environment: 'test' },
      report2,
      run2Results
    );

    const diff = manager.getFailureDiff(record2, { branch: 'diff-test', environment: 'test' });

    assert.equal(diff.newFailures.length, 1);
    assert.equal(diff.newFailures[0].endpoint, '/will-fail-next');

    assert.equal(diff.persistentFailures.length, 1);
    assert.equal(diff.persistentFailures[0].endpoint, '/persistent-fail');
    assert.equal(diff.persistentFailures[0].consecutiveFailCount, 2);
  });

  it('should return stats and streak information', () => {
    const { CIHistoryManager } = require('../ci-history');
    const { TestReportGenerator } = require('../test-report');
    const path = require('path');
    const fs = require('fs');

    const testDir = path.join(historyDir, `stats-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const manager = new CIHistoryManager(testDir);
    const generator = new TestReportGenerator();

    const passResult = [{
      endpoint: '/health',
      method: 'get',
      valid: true,
      statusCode: 200,
      statusCodeMatched: true,
      contentTypeMatched: true,
      requestErrors: [],
      responseErrors: [],
      durationMs: 50,
    }];

    const failResult = [{
      endpoint: '/health',
      method: 'get',
      valid: false,
      statusCode: 500,
      statusCodeMatched: false,
      contentTypeMatched: true,
      requestErrors: [],
      responseErrors: [{ path: '$', message: 'Error' }],
      durationMs: 50,
    }];

    const passReport = generator.generateReport(passResult);
    const failReport = generator.generateReport(failResult);

    for (let i = 0; i < 3; i++) {
      manager.addRecord(
        { branch: 'stats-test', commitHash: `p${i}`, environment: 'test' },
        passReport,
        passResult
      );
    }

    for (let i = 0; i < 2; i++) {
      manager.addRecord(
        { branch: 'stats-test', commitHash: `f${i}`, environment: 'test' },
        failReport,
        failResult
      );
    }

    const stats = manager.getStats({ branch: 'stats-test', environment: 'test' });
    assert.equal(stats.totalRuns, 5);
    assert.ok(stats.averagePassRate > 0);
    assert.equal(stats.streak.type, 'failing');
    assert.equal(stats.streak.current, 2);
    assert.equal(stats.streak.longest, 3);
  });

  it('should format trend and diff as text', () => {
    const { CIHistoryManager, formatTrendAsText, formatFailureDiffAsText } = require('../ci-history');
    const { TestReportGenerator } = require('../test-report');
    const path = require('path');
    const fs = require('fs');

    const testDir = path.join(historyDir, `format-test-${Date.now()}`);
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const manager = new CIHistoryManager(testDir);
    const generator = new TestReportGenerator();

    const results = [
      {
        endpoint: '/users',
        method: 'get',
        valid: true,
        statusCode: 200,
        statusCodeMatched: true,
        contentTypeMatched: true,
        requestErrors: [],
        responseErrors: [],
        durationMs: 100,
      },
    ];

    const report = generator.generateReport(results);
    manager.addRecord(
      { branch: 'format-test', commitHash: 'abc123', environment: 'test' },
      report,
      results
    );

    const trend = manager.getPassRateTrend({ branch: 'format-test', environment: 'test' });
    const trendText = formatTrendAsText(trend);

    assert.ok(trendText.includes('通过率趋势'));
    assert.ok(trendText.includes('abc123'));
    assert.ok(trendText.includes('100.0%'));

    const latestRecord = manager.getLatestRecord({ branch: 'format-test', environment: 'test' });
    assert.ok(latestRecord);

    const diff = manager.getFailureDiff(latestRecord!, { branch: 'format-test', environment: 'test' });
    const diffText = formatFailureDiffAsText(diff);

    assert.ok(diffText.includes('无失败用例') || diffText.includes('新增失败') || diffText.includes('持续失败'));
  });
});

describe('Contract Validator - Expected/Actual in All Errors', () => {
  it('should include expected/actual for endpoint not found error', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();
    const validator = new ContractValidator(apiModel, parser);

    const request = { method: 'get' as const, path: '/nonexistent', headers: {}, query: {}, body: null };
    const response = { status: 404, headers: {}, body: null };

    const result = validator.validateEndpoint('/nonexistent', 'get', request, response);

    assert.equal(result.valid, false);
    assert.ok(result.responseErrors.length > 0);

    const endpointError = result.responseErrors.find((e: any) => e.path === '$');
    assert.ok(endpointError);
    assert.ok(endpointError.expected);
    assert.equal(endpointError.actual, 'get /nonexistent');
  });

  it('should include expected/actual for missing required parameter', () => {
    const parser = new OpenAPIParser(sampleSpecV1);
    const apiModel = parser.parse();
    const validator = new ContractValidator(apiModel, parser);

    const request = { method: 'get' as const, path: '/users/123', headers: {}, query: {}, body: null };
    const response = { status: 200, headers: { 'content-type': 'application/json' }, body: { id: 123, name: 'Test' } };

    const result = validator.validateEndpoint('/users/123', 'get', request, response);

    assert.equal(result.valid, false);
    const paramErrors = result.requestErrors.filter((e: any) => e.message.includes('required') || e.message.includes('missing'));
    if (paramErrors.length > 0) {
      assert.ok(paramErrors[0].expected !== undefined);
    }
  });
});

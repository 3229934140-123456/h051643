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

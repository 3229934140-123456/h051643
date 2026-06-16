import {
  ApiModel,
  Endpoint,
  ValidationResult,
  ValidationError,
  MockRequest,
  MockResponse,
  SchemaObject,
  ParameterObject,
  HttpMethod,
} from '../types';
import { SchemaValidator } from './schema-validator';
import { OpenAPIParser } from '../openapi-parser';

export interface ContractValidationOptions {
  validateRequest?: boolean;
  validateResponse?: boolean;
  validateHeaders?: boolean;
  strictRequired?: boolean;
  allowAdditionalProperties?: boolean;
}

export interface ContractTestResult {
  endpoint: string;
  method: string;
  valid: boolean;
  requestErrors: ValidationError[];
  responseErrors: ValidationError[];
  statusCodeMatched: boolean;
  contentTypeMatched: boolean;
}

export class ContractValidator {
  private apiModel: ApiModel;
  private parser: OpenAPIParser;
  private validator: SchemaValidator;
  private options: Required<ContractValidationOptions>;

  constructor(apiModel: ApiModel, parser: OpenAPIParser, options: ContractValidationOptions = {}) {
    this.apiModel = apiModel;
    this.parser = parser;
    this.validator = new SchemaValidator();
    this.options = {
      validateRequest: true,
      validateResponse: true,
      validateHeaders: false,
      strictRequired: true,
      allowAdditionalProperties: true,
      ...options,
    };
  }

  validateEndpoint(
    path: string,
    method: HttpMethod,
    request: MockRequest,
    response: MockResponse,
  ): ContractTestResult {
    const endpoint = this.findEndpoint(path, method);

    if (!endpoint) {
      return {
        endpoint: path,
        method,
        valid: false,
        requestErrors: [],
        responseErrors: [{ path: '$', message: `Endpoint not found in spec: ${method} ${path}` }],
        statusCodeMatched: false,
        contentTypeMatched: false,
      };
    }

    const requestErrors = this.options.validateRequest
      ? this.validateRequest(endpoint, request)
      : [];

    const { responseErrors, statusCodeMatched, contentTypeMatched } = this.options.validateResponse
      ? this.validateResponse(endpoint, response)
      : { responseErrors: [], statusCodeMatched: true, contentTypeMatched: true };

    return {
      endpoint: path,
      method,
      valid: requestErrors.length === 0 && responseErrors.length === 0,
      requestErrors,
      responseErrors,
      statusCodeMatched,
      contentTypeMatched,
    };
  }

  private findEndpoint(path: string, method: HttpMethod): Endpoint | undefined {
    for (const endpoint of this.apiModel.endpoints) {
      if (endpoint.method !== method) continue;
      if (this.pathMatches(endpoint.path, path)) {
        return endpoint;
      }
    }
    return undefined;
  }

  private pathMatches(pattern: string, actual: string): boolean {
    const patternParts = pattern.split('/').filter((p) => p !== '');
    const actualParts = actual.split('/').filter((p) => p !== '');

    if (patternParts.length !== actualParts.length) return false;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith('{') && patternParts[i].endsWith('}')) {
        continue;
      }
      if (patternParts[i] !== actualParts[i]) {
        return false;
      }
    }

    return true;
  }

  private validateRequest(endpoint: Endpoint, request: MockRequest): ValidationError[] {
    const errors: ValidationError[] = [];

    errors.push(...this.validateParameters(endpoint.parameters, request));

    if (endpoint.requestBody) {
      errors.push(...this.validateRequestBody(endpoint, request.body));
    }

    return errors;
  }

  private validateParameters(parameters: ParameterObject[], request: MockRequest): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const param of parameters) {
      const paramValue = this.getParameterValue(param, request);

      if (param.required && (paramValue === undefined || paramValue === null)) {
        errors.push({
          path: `request.${param.in}.${param.name}`,
          message: `Required parameter "${param.name}" is missing`,
        });
        continue;
      }

      if (paramValue !== undefined && paramValue !== null && param.schema) {
        const result = this.validator.validate(paramValue, param.schema);
        if (!result.valid) {
          for (const err of result.errors) {
            errors.push({
              ...err,
              path: `request.${param.in}.${param.name}${err.path !== '$' ? err.path.slice(1) : ''}`,
            });
          }
        }
      }
    }

    return errors;
  }

  private getParameterValue(param: ParameterObject, request: MockRequest): any {
    switch (param.in) {
      case 'query':
        return request.query?.[param.name];
      case 'path':
        return this.extractPathParam(param.name, request.path);
      case 'header':
        return request.headers?.[param.name.toLowerCase()];
      case 'cookie':
        return undefined;
      default:
        return undefined;
    }
  }

  private extractPathParam(paramName: string, actualPath: string): string | undefined {
    const endpoint = this.findEndpoint(actualPath, 'get' as HttpMethod)
      || this.findEndpointForAnyMethod(actualPath);

    if (!endpoint) return undefined;

    return this.extractPathParamFromPattern(endpoint.path, actualPath, paramName);
  }

  private findEndpointForAnyMethod(actualPath: string): Endpoint | undefined {
    for (const endpoint of this.apiModel.endpoints) {
      if (this.pathMatches(endpoint.path, actualPath)) {
        return endpoint;
      }
    }
    return undefined;
  }

  private extractPathParamFromPattern(pattern: string, actual: string, paramName: string): string | undefined {
    const patternParts = pattern.split('/').filter((p) => p !== '');
    const actualParts = actual.split('/').filter((p) => p !== '');

    if (patternParts.length !== actualParts.length) return undefined;

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      if (patternPart.startsWith('{') && patternPart.endsWith('}')) {
        const name = patternPart.slice(1, -1);
        if (name === paramName) {
          return decodeURIComponent(actualParts[i]);
        }
      }
    }

    return undefined;
  }

  private validateRequestBody(endpoint: Endpoint, body: any): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!endpoint.requestBody) return errors;

    if (endpoint.requestBody.required && (body === undefined || body === null)) {
      errors.push({
        path: 'request.body',
        message: 'Required request body is missing',
      });
      return errors;
    }

    if (body === undefined || body === null) {
      return errors;
    }

    const content = endpoint.requestBody.content;
    const jsonContent = content?.['application/json'];

    if (jsonContent?.schema) {
      const result = this.validator.validate(body, jsonContent.schema);
      if (!result.valid) {
        for (const err of result.errors) {
          errors.push({
            ...err,
            path: `request.body${err.path !== '$' ? err.path.slice(1) : ''}`,
          });
        }
      }
    }

    return errors;
  }

  private validateResponse(
    endpoint: Endpoint,
    response: MockResponse,
  ): { responseErrors: ValidationError[]; statusCodeMatched: boolean; contentTypeMatched: boolean } {
    const errors: ValidationError[] = [];

    const statusCodeStr = String(response.status);
    const statusCodeMatched = !!endpoint.responses[statusCodeStr] || !!endpoint.responses['default'];

    if (!statusCodeMatched) {
      errors.push({
        path: 'response.status',
        message: `Unexpected response status code: ${response.status}`,
        expected: Object.keys(endpoint.responses).join(', '),
        actual: response.status,
      });
    }

    const responseSpec = endpoint.responses[statusCodeStr] || endpoint.responses['default'];

    if (!responseSpec) {
      return { responseErrors: errors, statusCodeMatched: false, contentTypeMatched: false };
    }

    const contentType = response.headers['content-type'] || response.headers['Content-Type'];
    const contentTypeMatched = this.matchContentType(contentType, responseSpec.content);

    if (responseSpec.content && !contentTypeMatched) {
      errors.push({
        path: 'response.content-type',
        message: `Unexpected content type: ${contentType}`,
        expected: Object.keys(responseSpec.content).join(', '),
        actual: contentType,
      });
    }

    if (responseSpec.content) {
      const jsonContent = responseSpec.content['application/json'];

      if (jsonContent?.schema) {
        if (response.body === undefined || response.body === null) {
          errors.push({
            path: 'response.body',
            message: 'Response body is empty but JSON schema is defined',
            expected: 'JSON object matching schema',
            actual: response.body === null ? 'null' : 'undefined',
          });
        } else {
          const result = this.validator.validate(response.body, jsonContent.schema);
          if (!result.valid) {
            for (const err of result.errors) {
              errors.push({
                ...err,
                path: `response.body${err.path !== '$' ? err.path.slice(1) : ''}`,
              });
            }
          }
        }
      }
    }

    return { responseErrors: errors, statusCodeMatched, contentTypeMatched };
  }

  private matchContentType(contentType: string | undefined, content: { [key: string]: any } | undefined): boolean {
    if (!content) return true;
    if (!contentType) return false;

    const simpleType = contentType.split(';')[0].trim().toLowerCase();

    for (const expectedType of Object.keys(content)) {
      if (expectedType.toLowerCase() === simpleType) return true;
      if (expectedType === '*/*') return true;
      if (expectedType.endsWith('/*')) {
        const expectedBase = expectedType.split('/')[0];
        const actualBase = simpleType.split('/')[0];
        if (expectedBase === actualBase) return true;
      }
    }

    return false;
  }

  validateResponseData(data: any, schema: SchemaObject): ValidationResult {
    return this.validator.validate(data, schema);
  }

  runContractTest(
    testCases: Array<{
      path: string;
      method: HttpMethod;
      request: MockRequest;
      response: MockResponse;
    }>,
  ): ContractTestResult[] {
    return testCases.map((tc) =>
      this.validateEndpoint(tc.path, tc.method, tc.request, tc.response),
    );
  }
}

export function createContractValidator(
  apiModel: ApiModel,
  parser: OpenAPIParser,
  options?: ContractValidationOptions,
): ContractValidator {
  return new ContractValidator(apiModel, parser, options);
}

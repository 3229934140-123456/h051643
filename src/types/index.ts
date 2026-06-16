export interface OpenAPISpec {
  openapi: string;
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
  paths: PathsObject;
  components?: ComponentsObject;
  tags?: OpenAPITag[];
}

export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface OpenAPITag {
  name: string;
  description?: string;
}

export interface PathsObject {
  [path: string]: PathItemObject;
}

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';

export interface PathItemObject {
  summary?: string;
  description?: string;
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  delete?: OperationObject;
  patch?: OperationObject;
  options?: OperationObject;
  head?: OperationObject;
  parameters?: ParameterObject[];
}

export interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: ResponsesObject;
  deprecated?: boolean;
}

export interface ParameterObject {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: SchemaObject;
  example?: any;
  examples?: { [key: string]: any };
}

export interface RequestBodyObject {
  description?: string;
  content: MediaTypesObject;
  required?: boolean;
}

export interface ResponsesObject {
  [statusCode: string]: ResponseObject;
}

export interface ResponseObject {
  description: string;
  content?: MediaTypesObject;
  headers?: { [name: string]: any };
}

export interface MediaTypesObject {
  [mediaType: string]: MediaTypeObject;
}

export interface MediaTypeObject {
  schema?: SchemaObject;
  example?: any;
  examples?: { [key: string]: any };
}

export type SchemaObject =
  | ObjectSchema
  | ArraySchema
  | StringSchema
  | NumberSchema
  | IntegerSchema
  | BooleanSchema
  | NullSchema
  | ReferenceObject
  | AllOfSchema
  | AnyOfSchema
  | OneOfSchema;

export interface BaseSchema {
  type?: string;
  title?: string;
  description?: string;
  default?: any;
  example?: any;
  nullable?: boolean;
  allOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  enum?: any[];
}

export interface ObjectSchema extends BaseSchema {
  type: 'object';
  properties?: { [propertyName: string]: SchemaObject };
  required?: string[];
  additionalProperties?: SchemaObject | boolean;
  minProperties?: number;
  maxProperties?: number;
}

export interface ArraySchema extends BaseSchema {
  type: 'array';
  items?: SchemaObject;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface StringSchema extends BaseSchema {
  type: 'string';
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}

export interface NumberSchema extends BaseSchema {
  type: 'number';
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

export interface IntegerSchema extends BaseSchema {
  type: 'integer';
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  multipleOf?: number;
  format?: string;
}

export interface BooleanSchema extends BaseSchema {
  type: 'boolean';
}

export interface NullSchema extends BaseSchema {
  type: 'null';
}

export interface AllOfSchema extends BaseSchema {
  allOf: SchemaObject[];
}

export interface AnyOfSchema extends BaseSchema {
  anyOf: SchemaObject[];
}

export interface OneOfSchema extends BaseSchema {
  oneOf: SchemaObject[];
}

export interface ReferenceObject {
  $ref: string;
}

export interface ComponentsObject {
  schemas?: { [key: string]: SchemaObject };
  responses?: { [key: string]: ResponseObject };
  parameters?: { [key: string]: ParameterObject };
  requestBodies?: { [key: string]: RequestBodyObject };
}

export interface ApiModel {
  info: OpenAPIInfo;
  servers: OpenAPIServer[];
  tags: OpenAPITag[];
  endpoints: Endpoint[];
  schemas: { [key: string]: SchemaObject };
}

export interface Endpoint {
  path: string;
  method: HttpMethod;
  summary?: string;
  description?: string;
  operationId?: string;
  tags: string[];
  parameters: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: { [statusCode: string]: ResponseObject };
  deprecated?: boolean;
}

export interface MockRequest {
  path: string;
  method: HttpMethod;
  query?: { [key: string]: any };
  body?: any;
  headers?: { [key: string]: string };
}

export interface MockResponse {
  status: number;
  headers: { [key: string]: string };
  body: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: any;
  actual?: any;
}

export interface CompatibilityResult {
  isCompatible: boolean;
  breakingChanges: BreakingChange[];
  nonBreakingChanges: NonBreakingChange[];
}

export interface BreakingChange {
  type: 'removed-endpoint' | 'removed-parameter' | 'removed-property' | 'changed-type' | 'changed-required' | 'added-required';
  path: string;
  method?: string;
  message: string;
  oldValue?: any;
  newValue?: any;
}

export interface NonBreakingChange {
  type: 'added-endpoint' | 'added-parameter' | 'added-property' | 'added-response';
  path: string;
  method?: string;
  message: string;
}

export interface MockState {
  resources: { [resourceType: string]: { [id: string]: any } };
  nextIds: { [resourceType: string]: number };
}

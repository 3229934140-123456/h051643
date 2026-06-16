import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import {
  HttpMethod,
  MockRequest,
  MockResponse,
} from '../types';
import {
  ContractValidator,
  ContractTestResult,
} from '../contract-validator';
import { TestCaseResult, TestReport, TestReportGenerator, formatReport } from '../test-report';

export interface ContractTestCase {
  id?: string;
  name?: string;
  path: string;
  method: HttpMethod;
  query?: { [key: string]: any };
  headers?: { [key: string]: string };
  body?: any;
  pathParams?: { [key: string]: string };
  skip?: boolean;
  timeoutMs?: number;
  retries?: number;
  slowThresholdMs?: number;
  tags?: string[];
}

export interface LiveTestConfig {
  baseUrl: string;
  defaultHeaders?: { [key: string]: string };
  timeoutMs?: number;
  validateRequest?: boolean;
  validateResponse?: boolean;
  retries?: number;
  retryDelayMs?: number;
  slowThresholdMs?: number;
  retryOnStatusCodes?: number[];
}

export interface LiveTestResult {
  report: TestReport;
  results: TestCaseResult[];
  slowEndpoints: Array<{
    endpoint: string;
    method: string;
    durationMs: number;
    thresholdMs: number;
    requestUrl: string;
  }>;
  recoveredAfterRetry: TestCaseResult[];
  rawResponses: Array<{
    testCase: ContractTestCase;
    request: MockRequest;
    response: MockResponse;
    validation: ContractTestResult;
    retryCount: number;
    isSlowEndpoint: boolean;
  }>;
}

export interface LiveTestOutputOptions {
  reportFormat?: 'json' | 'text' | 'html';
  outputPath?: string;
  printReport?: boolean;
  exitOnFailure?: boolean;
}

export interface TestSuiteFile {
  baseUrl?: string;
  defaultHeaders?: { [key: string]: string };
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  slowThresholdMs?: number;
  env?: { [key: string]: string };
  testCases: ContractTestCase[];
}

export interface CIJsonOutput {
  version: string;
  timestamp: string;
  baseUrl: string;
  specPath?: string;
  effectiveConfig: {
    baseUrl: string;
    defaultHeaders: { [key: string]: string };
    timeoutMs: number;
    retries: number;
    slowThresholdMs: number;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    recoveredAfterRetry: number;
    slowEndpoints: number;
    passRate: string;
    totalDurationMs: number;
  };
  results: Array<{
    id?: string;
    name?: string;
    method: string;
    endpoint: string;
    requestUrl: string;
    statusCode: number;
    statusCodeMatched: boolean;
    contentTypeMatched: boolean;
    valid: boolean;
    durationMs: number;
    retryCount: number;
    recoveredAfterRetry: boolean;
    isSlowEndpoint: boolean;
    errorCount: number;
    errors: Array<{
      side: 'request' | 'response';
      path: string;
      message: string;
      category?: string;
      expected?: any;
      actual?: any;
    }>;
  }>;
  slowEndpoints: Array<{
    endpoint: string;
    method: string;
    durationMs: number;
    thresholdMs: number;
    requestUrl: string;
  }>;
  exitCode: number;
}

function substituteEnvVars(value: string, env: { [key: string]: string }): string {
  return value.replace(/\$\{(\w+)\}/g, (match, varName) => {
    if (env[varName] !== undefined) return env[varName];
    if (process.env[varName] !== undefined) return process.env[varName]!;
    return match;
  });
}

function deepSubstituteEnvVars(obj: any, env: { [key: string]: string }): any {
  if (typeof obj === 'string') return substituteEnvVars(obj, env);
  if (Array.isArray(obj)) return obj.map((item) => deepSubstituteEnvVars(item, env));
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepSubstituteEnvVars(value, env);
    }
    return result;
  }
  return obj;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LiveContractTester {
  private config: Required<LiveTestConfig>;
  private validator: ContractValidator;
  private _effectiveBaseUrl: string = '';
  private _effectiveDefaultHeaders: { [key: string]: string } = {};

  constructor(config: LiveTestConfig, validator: ContractValidator) {
    this.config = {
      baseUrl: config.baseUrl,
      defaultHeaders: config.defaultHeaders || {},
      timeoutMs: config.timeoutMs || 30000,
      validateRequest: config.validateRequest ?? true,
      validateResponse: config.validateResponse ?? true,
      retries: config.retries ?? 0,
      retryDelayMs: config.retryDelayMs ?? 1000,
      slowThresholdMs: config.slowThresholdMs ?? 3000,
      retryOnStatusCodes: config.retryOnStatusCodes ?? [0, 500, 502, 503, 504],
    };
    this.validator = validator;
  }

  get effectiveBaseUrl(): string {
    return this._effectiveBaseUrl || this.config.baseUrl;
  }

  get effectiveDefaultHeaders(): { [key: string]: string } {
    return { ...(this._effectiveDefaultHeaders || this.config.defaultHeaders) };
  }

  async runTests(testCases: ContractTestCase[]): Promise<LiveTestResult> {
    const results: TestCaseResult[] = [];
    const rawResponses: LiveTestResult['rawResponses'] = [];
    const slowEndpoints: LiveTestResult['slowEndpoints'] = [];
    const recoveredAfterRetry: TestCaseResult[] = [];

    this._effectiveBaseUrl = this.config.baseUrl;
    this._effectiveDefaultHeaders = { ...this.config.defaultHeaders };

    for (const tc of testCases) {
      if (tc.skip) continue;

      const tcRetries = tc.retries ?? this.config.retries;
      const tcSlowThreshold = tc.slowThresholdMs ?? this.config.slowThresholdMs;

      let mockRequest = this.buildMockRequest(tc);
      const requestUrl = this.buildFullUrl(mockRequest);
      let mockResponse: MockResponse;
      let validation: ContractTestResult;
      let retryCount = 0;
      let lastError: any = null;
      let firstFailAt = -1;

      for (let attempt = 0; attempt <= tcRetries; attempt++) {
        const startTime = Date.now();
        try {
          mockResponse = await this.sendRequest(tc, mockRequest);
          validation = this.validator.validateEndpoint(
            mockRequest.path,
            tc.method,
            mockRequest,
            mockResponse,
          );
          const duration = Date.now() - startTime;
          const isServerError = this.config.retryOnStatusCodes.includes(mockResponse.status);

          if (validation.valid && !isServerError) {
            const isSlowEndpoint = duration > tcSlowThreshold;
            const recovered = firstFailAt === 0 && attempt > 0;

            const contentType = mockResponse.headers?.['content-type'];
            const testCaseResult: TestCaseResult = {
              endpoint: mockRequest.path,
              method: tc.method,
              valid: true,
              statusCode: mockResponse.status,
              statusCodeMatched: validation.statusCodeMatched,
              contentTypeMatched: validation.contentTypeMatched,
              requestErrors: [],
              responseErrors: [],
              testCaseId: tc.id,
              testCaseName: tc.name,
              durationMs: duration,
              requestUrl,
              contentType: contentType || undefined,
              retryCount,
              recoveredAfterRetry: recovered,
              isSlowEndpoint,
            };

            results.push(testCaseResult);
            rawResponses.push({
              testCase: tc,
              request: mockRequest,
              response: mockResponse,
              validation,
              retryCount,
              isSlowEndpoint,
            });

            if (isSlowEndpoint) {
              slowEndpoints.push({
                endpoint: mockRequest.path,
                method: tc.method,
                durationMs: duration,
                thresholdMs: tcSlowThreshold,
                requestUrl,
              });
            }

            if (recovered) {
              recoveredAfterRetry.push(testCaseResult);
            }
            break;
          }

          if (attempt === 0) firstFailAt = 0;
          if (attempt < tcRetries && (isServerError || validation.valid === false)) {
            retryCount++;
            await sleep(this.config.retryDelayMs);
            continue;
          }

          const isSlowEndpoint = duration > tcSlowThreshold;
          const contentType = mockResponse.headers?.['content-type'];
          const testCaseResult: TestCaseResult = {
            endpoint: mockRequest.path,
            method: tc.method,
            valid: validation.valid,
            statusCode: mockResponse.status,
            statusCodeMatched: validation.statusCodeMatched,
            contentTypeMatched: validation.contentTypeMatched,
            requestErrors: validation.requestErrors,
            responseErrors: validation.responseErrors,
            testCaseId: tc.id,
            testCaseName: tc.name,
            durationMs: duration,
            requestUrl,
            contentType: contentType || undefined,
            retryCount,
            recoveredAfterRetry: false,
            isSlowEndpoint,
          };

          results.push(testCaseResult);
          rawResponses.push({
            testCase: tc,
            request: mockRequest,
            response: mockResponse,
            validation,
            retryCount,
            isSlowEndpoint,
          });

          if (isSlowEndpoint) {
            slowEndpoints.push({
              endpoint: mockRequest.path,
              method: tc.method,
              durationMs: duration,
              thresholdMs: tcSlowThreshold,
              requestUrl,
            });
          }
          break;
        } catch (err: any) {
          lastError = err;
          if (attempt === 0) firstFailAt = 0;
          if (attempt < tcRetries) {
            retryCount++;
            await sleep(this.config.retryDelayMs);
            continue;
          }

          const duration = Date.now() - (mockRequest as any)._startTime || 0;
          mockResponse = {
            status: 0,
            headers: {},
            body: null,
          };
          validation = {
            endpoint: mockRequest.path,
            method: tc.method,
            valid: false,
            requestErrors: [],
            responseErrors: [{
              path: '$',
              message: `Request failed: ${err.message || String(err)}`,
              actual: err.code || 'NETWORK_ERROR',
              expected: 'successful connection',
            }],
            statusCodeMatched: false,
            contentTypeMatched: false,
          };

          const isSlowEndpoint = duration > tcSlowThreshold;
          const testCaseResult: TestCaseResult = {
            endpoint: mockRequest.path,
            method: tc.method,
            valid: false,
            statusCode: 0,
            statusCodeMatched: false,
            contentTypeMatched: false,
            requestErrors: [],
            responseErrors: validation.responseErrors,
            testCaseId: tc.id,
            testCaseName: tc.name,
            durationMs: duration,
            requestUrl,
            contentType: undefined,
            retryCount,
            recoveredAfterRetry: false,
            isSlowEndpoint,
          };

          results.push(testCaseResult);
          rawResponses.push({
            testCase: tc,
            request: mockRequest,
            response: mockResponse,
            validation,
            retryCount,
            isSlowEndpoint,
          });
          break;
        }
      }
    }

    const reportGenerator = new TestReportGenerator();
    const report = reportGenerator.generateReport(results);

    return { report, results, slowEndpoints, recoveredAfterRetry, rawResponses };
  }

  async runTestSuite(suite: TestSuiteFile): Promise<LiveTestResult> {
    const mergedEnv: { [key: string]: string } = {};
    if (suite.env) {
      for (const [k, v] of Object.entries(suite.env)) {
        mergedEnv[k] = substituteEnvVars(v, process.env as any);
      }
    }

    const resolvedBaseUrl = substituteEnvVars(suite.baseUrl || this.config.baseUrl, mergedEnv);
    const resolvedDefaultHeaders = deepSubstituteEnvVars({ ...this.config.defaultHeaders, ...suite.defaultHeaders }, mergedEnv);

    this._effectiveBaseUrl = resolvedBaseUrl;
    this._effectiveDefaultHeaders = resolvedDefaultHeaders;

    const resolvedCases: ContractTestCase[] = deepSubstituteEnvVars(suite.testCases, mergedEnv);

    const config: LiveTestConfig = {
      ...this.config,
      baseUrl: resolvedBaseUrl,
      defaultHeaders: resolvedDefaultHeaders,
      timeoutMs: suite.timeoutMs || this.config.timeoutMs,
      retries: suite.retries ?? this.config.retries,
      retryDelayMs: suite.retryDelayMs ?? this.config.retryDelayMs,
      slowThresholdMs: suite.slowThresholdMs ?? this.config.slowThresholdMs,
    };

    const originalConfig = this.config;
    this.config = config as Required<LiveTestConfig>;

    const result = await this.runTests(resolvedCases);

    this.config = originalConfig;
    return result;
  }

  static async loadTestSuite(filePath: string): Promise<TestSuiteFile> {
    const absPath = path.resolve(filePath);
    const content = fs.readFileSync(absPath, 'utf-8');
    const suite: TestSuiteFile = JSON.parse(content);

    if (suite.testCases) {
      const dir = path.dirname(absPath);
      for (const tc of suite.testCases) {
        if (tc.body && typeof tc.body === 'string' && tc.body.endsWith('.json')) {
          const bodyPath = path.resolve(dir, tc.body as string);
          if (fs.existsSync(bodyPath)) {
            tc.body = JSON.parse(fs.readFileSync(bodyPath, 'utf-8'));
          }
        }
      }
    }

    return suite;
  }

  generateCIJsonOutput(result: LiveTestResult, baseUrl?: string, specPath?: string): CIJsonOutput {
    const s = result.report.summary;
    const exitCode = s.failed > 0 ? 1 : 0;

    const ciResults = result.results.map((r) => {
      const allErrors = [
        ...r.requestErrors.map((e) => ({ ...e, side: 'request' as const })),
        ...r.responseErrors.map((e) => ({ ...e, side: 'response' as const })),
      ];

      return {
        id: r.testCaseId || undefined,
        name: r.testCaseName || undefined,
        method: r.method.toUpperCase(),
        endpoint: r.endpoint,
        requestUrl: r.requestUrl || '',
        statusCode: r.statusCode,
        statusCodeMatched: r.statusCodeMatched,
        contentTypeMatched: r.contentTypeMatched,
        valid: r.valid,
        durationMs: r.durationMs || 0,
        retryCount: r.retryCount || 0,
        recoveredAfterRetry: !!r.recoveredAfterRetry,
        isSlowEndpoint: !!r.isSlowEndpoint,
        errorCount: allErrors.length,
        errors: allErrors.map((e) => {
          const msg = e.message.toLowerCase();
          let category = 'other';
          if (msg.includes('required') || msg.includes('missing')) category = 'missing';
          else if (msg.includes('expected type') || (msg.includes('type') && !msg.includes('content-type'))) category = 'type';
          else if (msg.includes('format') || msg.includes('uuid') || msg.includes('email')) category = 'format';
          else if (msg.includes('enum') || msg.includes('allowed')) category = 'enum';
          else if (msg.includes('status') || msg.includes('unexpected')) category = 'status';
          else if (msg.includes('content-type')) category = 'content-type';
          else if (msg.includes('network') || msg.includes('failed')) category = 'network';

          return {
            side: e.side,
            path: e.path,
            message: e.message,
            category,
            expected: e.expected,
            actual: e.actual,
          };
        }),
      };
    });

    return {
      version: '1.1',
      timestamp: new Date().toISOString(),
      baseUrl: baseUrl || this.effectiveBaseUrl,
      specPath,
      effectiveConfig: {
        baseUrl: this.effectiveBaseUrl,
        defaultHeaders: this.effectiveDefaultHeaders,
        timeoutMs: this.config.timeoutMs,
        retries: this.config.retries,
        slowThresholdMs: this.config.slowThresholdMs,
      },
      summary: {
        total: s.total,
        passed: s.passed,
        failed: s.failed,
        recoveredAfterRetry: (result.recoveredAfterRetry || []).length,
        slowEndpoints: (result.slowEndpoints || []).length,
        passRate: `${s.passRate}%`,
        totalDurationMs: s.totalDurationMs,
      },
      results: ciResults,
      slowEndpoints: result.slowEndpoints || [],
      exitCode,
    };
  }

  private buildMockRequest(tc: ContractTestCase): MockRequest {
    let resolvedPath = tc.path;
    if (tc.pathParams) {
      for (const [key, value] of Object.entries(tc.pathParams)) {
        resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(String(value)));
      }
    }

    return {
      path: resolvedPath,
      method: tc.method,
      query: tc.query,
      body: tc.body,
      headers: { ...this.config.defaultHeaders, ...tc.headers },
    };
  }

  private async sendRequest(tc: ContractTestCase, request: MockRequest): Promise<MockResponse> {
    return new Promise((resolve, reject) => {
      const fullUrl = this.buildFullUrl(request);
      const parsed = url.parse(fullUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      const timeout = tc.timeoutMs || this.config.timeoutMs;

      let pathWithQuery = parsed.pathname || '/';
      const searchParams = new URLSearchParams();
      if (parsed.query) {
        for (const [k, v] of new URLSearchParams(parsed.query)) {
          searchParams.set(k, v);
        }
      }
      if (request.query) {
        for (const [k, v] of Object.entries(request.query)) {
          if (v !== undefined && v !== null) {
            searchParams.set(k, String(v));
          }
        }
      }
      const queryStr = searchParams.toString();
      if (queryStr) pathWithQuery += `?${queryStr}`;

      const headers: { [key: string]: string } = {};
      if (request.headers) {
        for (const [k, v] of Object.entries(request.headers)) {
          headers[k.toLowerCase()] = v;
        }
      }

      let bodyData: string | undefined;
      if (request.body !== undefined && request.body !== null) {
        if (typeof request.body === 'string') {
          bodyData = request.body;
          if (!headers['content-type']) {
            headers['content-type'] = 'text/plain';
          }
        } else {
          bodyData = JSON.stringify(request.body);
          if (!headers['content-type']) {
            headers['content-type'] = 'application/json';
          }
        }
        headers['content-length'] = String(Buffer.byteLength(bodyData));
      }

      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port) : (isHttps ? 443 : 80),
        path: pathWithQuery,
        method: tc.method.toUpperCase(),
        headers,
        timeout,
      };

      (request as any)._startTime = Date.now();

      const req = lib.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const responseHeaders: { [key: string]: string } = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) {
              responseHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
            }
          }

          let body: any = rawBody;
          const contentType = responseHeaders['content-type'] || '';
          if (contentType.includes('application/json') && rawBody.trim()) {
            try {
              body = JSON.parse(rawBody);
            } catch {
            }
          }

          resolve({
            status: res.statusCode || 0,
            headers: responseHeaders,
            body,
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`Request timed out after ${timeout}ms`));
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    });
  }

  private buildFullUrl(request: MockRequest): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const reqPath = request.path.startsWith('/') ? request.path : `/${request.path}`;
    return base + reqPath;
  }

  formatOutput(result: LiveTestResult, options: LiveTestOutputOptions = {}): string {
    return formatReport(result.report, options.reportFormat || 'text');
  }
}

export async function runLiveContractTests(
  config: LiveTestConfig,
  testCases: ContractTestCase[],
  validator: ContractValidator,
  outputOptions: LiveTestOutputOptions = {},
): Promise<LiveTestResult> {
  const tester = new LiveContractTester(config, validator);
  const result = await tester.runTests(testCases);

  if (outputOptions.printReport) {
    console.log(tester.formatOutput(result, outputOptions));
  }

  if (outputOptions.outputPath) {
    const fsModule = await import('fs');
    const content = tester.formatOutput(result, outputOptions);
    fsModule.writeFileSync(outputOptions.outputPath, content, 'utf-8');
  }

  if (outputOptions.exitOnFailure && result.report.summary.failed > 0) {
    process.exitCode = 1;
  }

  return result;
}

export async function runCITestSuite(
  specPath: string,
  suitePath: string,
  outputOptions: {
    jsonOutputPath?: string;
    reportOutputPath?: string;
    printSummary?: boolean;
  } = {},
): Promise<{ result: LiveTestResult; ciOutput: CIJsonOutput; exitCode: number }> {
  const { OpenAPIParser } = await import('../openapi-parser');
  const { ContractValidator: CV } = await import('../contract-validator');

  const specContent = fs.readFileSync(path.resolve(specPath), 'utf-8');
  const spec = JSON.parse(specContent);
  const parser = new OpenAPIParser(spec);
  const apiModel = parser.parse();
  const validator = new CV(apiModel, parser);

  const suite = await LiveContractTester.loadTestSuite(suitePath);

  const baseUrl = suite.baseUrl || 'http://localhost:3000';
  const tester = new LiveContractTester({ baseUrl }, validator);

  const result = await tester.runTestSuite(suite);

  const ciOutput = tester.generateCIJsonOutput(result, tester.effectiveBaseUrl, specPath);
  const exitCode = ciOutput.exitCode;

  if (outputOptions.jsonOutputPath) {
    fs.writeFileSync(
      path.resolve(outputOptions.jsonOutputPath),
      JSON.stringify(ciOutput, null, 2),
      'utf-8',
    );
  }

  if (outputOptions.reportOutputPath) {
    const reportGenerator = new TestReportGenerator();
    const format = outputOptions.reportOutputPath.endsWith('.html') ? 'html' :
                   outputOptions.reportOutputPath.endsWith('.json') ? 'json' : 'text';
    const content = format === 'html' ? reportGenerator.formatAsHTML(result.report) :
                    format === 'json' ? reportGenerator.formatAsJSON(result.report) :
                    formatExtendedTextReport(result.report, result);
    fs.writeFileSync(path.resolve(outputOptions.reportOutputPath), content, 'utf-8');
  }

  if (outputOptions.printSummary) {
    const s = result.report.summary;
    console.log(`\n契约测试完成: ${s.passed}/${s.total} 通过 (${s.passRate}%)`);
    if (result.recoveredAfterRetry.length > 0) {
      console.log(`重试后恢复: ${result.recoveredAfterRetry.length} 个偶发问题`);
    }
    if (result.slowEndpoints.length > 0) {
      console.log(`慢接口警告: ${result.slowEndpoints.length} 个接口超过阈值`);
      for (const se of result.slowEndpoints) {
        console.log(`  - ${se.method} ${se.endpoint} (${se.durationMs}ms > ${se.thresholdMs}ms)`);
      }
    }
    console.log(`退出码: ${exitCode}`);
    if (s.failed > 0) {
      console.log(`失败 ${s.failed} 个用例，详见 ${outputOptions.jsonOutputPath || outputOptions.reportOutputPath || '上方报告'}`);
    }
  }

  process.exitCode = exitCode;

  return { result, ciOutput, exitCode };
}

function formatExtendedTextReport(report: TestReport, result: LiveTestResult): string {
  const generator = new TestReportGenerator();
  const baseText = generator.formatAsText(report, { verbose: true });

  const extraLines: string[] = ['', '── 补充信息 ─────────────────────────────────────────────'];

  if (result.recoveredAfterRetry.length > 0) {
    extraLines.push('✅ 重试后恢复的偶发问题:');
    for (const r of result.recoveredAfterRetry) {
      extraLines.push(`  ${r.method.toUpperCase()} ${r.endpoint} (重试 ${r.retryCount || 0} 次后通过)`);
    }
  }

  if (result.slowEndpoints.length > 0) {
    extraLines.push('⚠️  慢接口警告:');
    for (const se of result.slowEndpoints) {
      extraLines.push(`  ${se.method} ${se.endpoint} - ${se.durationMs}ms (阈值: ${se.thresholdMs}ms)`);
    }
  }

  return baseText + '\n' + extraLines.join('\n');
}

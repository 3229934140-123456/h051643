import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
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
}

export interface LiveTestConfig {
  baseUrl: string;
  defaultHeaders?: { [key: string]: string };
  timeoutMs?: number;
  validateRequest?: boolean;
  validateResponse?: boolean;
}

export interface LiveTestResult {
  report: TestReport;
  results: TestCaseResult[];
  rawResponses: Array<{
    testCase: ContractTestCase;
    request: MockRequest;
    response: MockResponse;
    validation: ContractTestResult;
  }>;
}

export interface LiveTestOutputOptions {
  reportFormat?: 'json' | 'text' | 'html';
  outputPath?: string;
  printReport?: boolean;
  exitOnFailure?: boolean;
}

export class LiveContractTester {
  private config: Required<LiveTestConfig>;
  private validator: ContractValidator;

  constructor(config: LiveTestConfig, validator: ContractValidator) {
    this.config = {
      baseUrl: config.baseUrl,
      defaultHeaders: config.defaultHeaders || {},
      timeoutMs: config.timeoutMs || 30000,
      validateRequest: config.validateRequest ?? true,
      validateResponse: config.validateResponse ?? true,
    };
    this.validator = validator;
  }

  async runTests(testCases: ContractTestCase[]): Promise<LiveTestResult> {
    const results: TestCaseResult[] = [];
    const rawResponses: LiveTestResult['rawResponses'] = [];

    for (const tc of testCases) {
      if (tc.skip) continue;

      const startTime = Date.now();

      const mockRequest = this.buildMockRequest(tc);
      let mockResponse: MockResponse;
      let validation: ContractTestResult;

      try {
        mockResponse = await this.sendRequest(tc, mockRequest);
        validation = this.validator.validateEndpoint(
          mockRequest.path,
          tc.method,
          mockRequest,
          mockResponse,
        );
      } catch (err: any) {
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
          }],
          statusCodeMatched: false,
          contentTypeMatched: false,
        };
      }

      const duration = Date.now() - startTime;

      const testCaseResult: TestCaseResult = {
        ...validation,
        testCaseId: tc.id,
        testCaseName: tc.name,
        durationMs: duration,
      } as TestCaseResult;

      results.push(testCaseResult);
      rawResponses.push({
        testCase: tc,
        request: mockRequest,
        response: mockResponse,
        validation,
      });
    }

    const reportGenerator = new TestReportGenerator();
    const report = reportGenerator.generateReport(results);

    return { report, results, rawResponses };
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
    let base = this.config.baseUrl.replace(/\/$/, '');
    const path = request.path.startsWith('/') ? request.path : `/${request.path}`;
    return base + path;
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
    const fs = await import('fs');
    const content = tester.formatOutput(result, outputOptions);
    fs.writeFileSync(outputOptions.outputPath, content, 'utf-8');
  }

  if (outputOptions.exitOnFailure && result.report.summary.failed > 0) {
    process.exitCode = 1;
  }

  return result;
}

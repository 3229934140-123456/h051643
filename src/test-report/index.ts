import { ValidationError } from '../types';

export interface TestCaseResult {
  testCaseId?: string;
  testCaseName?: string;
  endpoint: string;
  method: string;
  valid: boolean;
  statusCode: number;
  statusCodeMatched: boolean;
  contentTypeMatched: boolean;
  requestErrors: ValidationError[];
  responseErrors: ValidationError[];
  durationMs?: number;
  requestUrl?: string;
  contentType?: string;
  retryCount?: number;
  recoveredAfterRetry?: boolean;
  isSlowEndpoint?: boolean;
}

export type FailureCategory =
  | 'status_code_error'
  | 'response_structure_error'
  | 'auth_error'
  | 'network_error'
  | 'request_validation_error'
  | 'content_type_error'
  | 'other_error';

export interface AttributionItem {
  category: FailureCategory;
  categoryLabel: string;
  icon: string;
  count: number;
  percentage: number;
  testCases: Array<{
    testCaseId?: string;
    testCaseName?: string;
    endpoint: string;
    method: string;
    statusCode: number;
    requestUrl?: string;
    errorCount: number;
  }>;
  topErrors: Array<{
    message: string;
    count: number;
    paths: string[];
  }>;
}

export interface AttributionSummary {
  totalFailures: number;
  byCategory: AttributionItem[];
  topEndpoints: Array<{ endpoint: string; method: string; failureCount: number; passRate: number; total: number }>;
  topErrorMessages: Array<{ message: string; count: number; percentage: number }>;
}

export interface SummaryStats {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  totalDurationMs: number;
  byMethod: MethodGroupStats[];
  byRealStatusCode: RealStatusCodeGroupStats[];
  byValidationType: ValidationTypeStats;
  failedEndpointsCount: number;
  totalEndpointsCount: number;
  recoveredAfterRetry: number;
  slowEndpoints: number;
}

export interface MethodGroupStats {
  method: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

export interface RealStatusCodeGroupStats {
  statusCode: number;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

export interface ValidationTypeStats {
  requestValidation: { total: number; failed: number };
  responseValidation: { total: number; failed: number };
  statusCodeValidation: { total: number; failed: number };
  contentTypeValidation: { total: number; failed: number };
}

export interface EndpointGroupStats {
  endpoint: string;
  method: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  testCases: TestCaseResult[];
}

export type ErrorCategory = 'type' | 'missing' | 'format' | 'enum' | 'range' | 'status' | 'content-type' | 'other';

export interface CategorizedError extends ValidationError {
  category: ErrorCategory;
  expected?: any;
  actual?: any;
  suggestions?: string[];
}

export interface FailedCaseDetail {
  testCaseId?: string;
  testCaseName?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  statusCodeMatched: boolean;
  contentTypeMatched: boolean;
  contentType?: string;
  requestUrl?: string;
  requestErrors: CategorizedError[];
  responseErrors: CategorizedError[];
  commonRootCauses: string[];
  durationMs?: number;
  retryCount?: number;
  recoveredAfterRetry?: boolean;
  isSlowEndpoint?: boolean;
}

export interface FailedCaseFilter {
  side?: 'request' | 'response' | 'both';
  statusCode?: number;
  statusCodeMismatch?: boolean;
  contentTypeMismatch?: boolean;
  category?: ErrorCategory;
  failureCategory?: FailureCategory;
}

export interface TestReport {
  generatedAt: string;
  summary: SummaryStats;
  endpoints: EndpointGroupStats[];
  failedDetails: FailedCaseDetail[];
  attribution: AttributionSummary;
  filterFailedDetails(filter: FailedCaseFilter): FailedCaseDetail[];
}

const CATEGORY_META: Record<FailureCategory, { label: string; icon: string }> = {
  status_code_error: { label: '状态码错误', icon: '🔴' },
  response_structure_error: { label: '响应结构错误', icon: '📦' },
  auth_error: { label: '鉴权错误', icon: '🔐' },
  network_error: { label: '网络错误', icon: '🌐' },
  request_validation_error: { label: '请求参数错误', icon: '📥' },
  content_type_error: { label: 'Content-Type 错误', icon: '🏷️' },
  other_error: { label: '其他错误', icon: '❓' },
};

export class TestReportGenerator {
  generateReport(results: TestCaseResult[]): TestReport {
    const summary = this.buildSummary(results);
    const endpoints = this.buildEndpointGroups(results);
    const failedDetails = this.buildFailedDetails(results);
    const attribution = this.buildAttributionSummary(results);

    return {
      generatedAt: new Date().toISOString(),
      summary,
      endpoints,
      failedDetails,
      attribution,
      filterFailedDetails(filter: FailedCaseFilter): FailedCaseDetail[] {
        return failedDetails.filter((d) => {
          if (filter.side === 'request' && d.requestErrors.length === 0) return false;
          if (filter.side === 'response' && d.responseErrors.length === 0) return false;
          if (filter.statusCode !== undefined && d.statusCode !== filter.statusCode) return false;
          if (filter.statusCodeMismatch === true && d.statusCodeMatched) return false;
          if (filter.contentTypeMismatch === true && d.contentTypeMatched) return false;
          if (filter.category !== undefined) {
            const allErrors = [...d.requestErrors, ...d.responseErrors];
            if (!allErrors.some((e) => e.category === filter.category)) return false;
          }
          if (filter.failureCategory !== undefined) {
            const dCategory = categorizeTestCaseFailure(
              (d as any)._sourceResult as TestCaseResult,
            );
            if (dCategory !== filter.failureCategory) return false;
          }
          return true;
        });
      },
    };
  }

  private buildSummary(results: TestCaseResult[]): SummaryStats {
    const total = results.length;
    const passed = results.filter((r) => r.valid).length;
    const failed = total - passed;
    const passRate = total === 0 ? 100 : Math.round((passed / total) * 10000) / 100;
    const totalDurationMs = results.reduce((s, r) => s + (r.durationMs || 0), 0);
    const recoveredAfterRetry = results.filter((r) => r.recoveredAfterRetry).length;
    const slowEndpoints = results.filter((r) => r.isSlowEndpoint).length;

    const methodMap = new Map<string, TestCaseResult[]>();
    for (const r of results) {
      if (!methodMap.has(r.method)) methodMap.set(r.method, []);
      methodMap.get(r.method)!.push(r);
    }
    const byMethod: MethodGroupStats[] = [];
    for (const [method, items] of methodMap.entries()) {
      const mPassed = items.filter((r) => r.valid).length;
      byMethod.push({
        method: method.toUpperCase(),
        total: items.length,
        passed: mPassed,
        failed: items.length - mPassed,
        passRate: items.length === 0 ? 100 : Math.round((mPassed / items.length) * 10000) / 100,
      });
    }
    byMethod.sort((a, b) => a.method.localeCompare(b.method));

    const scMap = new Map<number, TestCaseResult[]>();
    for (const r of results) {
      if (!scMap.has(r.statusCode)) scMap.set(r.statusCode, []);
      scMap.get(r.statusCode)!.push(r);
    }
    const byRealStatusCode: RealStatusCodeGroupStats[] = [];
    for (const [statusCode, items] of scMap.entries()) {
      const scPassed = items.filter((r) => r.valid).length;
      byRealStatusCode.push({
        statusCode,
        total: items.length,
        passed: scPassed,
        failed: items.length - scPassed,
        passRate: items.length === 0 ? 100 : Math.round((scPassed / items.length) * 10000) / 100,
      });
    }
    byRealStatusCode.sort((a, b) => a.statusCode - b.statusCode);

    const totalWithRequestErrors = results.filter((r) => r.requestErrors.length > 0).length;
    const totalWithResponseErrors = results.filter((r) => r.responseErrors.length > 0).length;
    const totalWithStatusErrors = results.filter((r) => !r.statusCodeMatched).length;
    const totalWithContentTypeErrors = results.filter((r) => !r.contentTypeMatched).length;

    const byValidationType: ValidationTypeStats = {
      requestValidation: { total, failed: totalWithRequestErrors },
      responseValidation: { total, failed: totalWithResponseErrors },
      statusCodeValidation: { total, failed: totalWithStatusErrors },
      contentTypeValidation: { total, failed: totalWithContentTypeErrors },
    };

    const endpointKeys = new Set<string>();
    const failedEndpointKeys = new Set<string>();
    for (const r of results) {
      const key = `${r.method}:${r.endpoint}`;
      endpointKeys.add(key);
      if (!r.valid) failedEndpointKeys.add(key);
    }

    return {
      total,
      passed,
      failed,
      passRate,
      totalDurationMs,
      byMethod,
      byRealStatusCode,
      byValidationType,
      failedEndpointsCount: failedEndpointKeys.size,
      totalEndpointsCount: endpointKeys.size,
      recoveredAfterRetry,
      slowEndpoints,
    };
  }

  private buildEndpointGroups(results: TestCaseResult[]): EndpointGroupStats[] {
    const map = new Map<string, TestCaseResult[]>();
    for (const r of results) {
      const key = `${r.method}:${r.endpoint}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

    const groups: EndpointGroupStats[] = [];
    for (const [key, items] of map.entries()) {
      const [method, endpoint] = key.split(':', 2);
      const egPassed = items.filter((r) => r.valid).length;
      groups.push({
        endpoint,
        method: method.toUpperCase(),
        total: items.length,
        passed: egPassed,
        failed: items.length - egPassed,
        passRate: items.length === 0 ? 100 : Math.round((egPassed / items.length) * 10000) / 100,
        testCases: items,
      });
    }
    groups.sort((a, b) => `${a.method}${a.endpoint}`.localeCompare(`${b.method}${b.endpoint}`));
    return groups;
  }

  private buildFailedDetails(results: TestCaseResult[]): FailedCaseDetail[] {
    return results
      .filter((r) => !r.valid)
      .map((r) => {
        const commonRootCauses = this.analyzeRootCauses(r);
        const requestErrors = r.requestErrors.map((e) => this.categorizeError(e));
        const responseErrors = r.responseErrors.map((e) => this.categorizeError(e));

        const detail: FailedCaseDetail & { _sourceResult?: TestCaseResult } = {
          testCaseId: r.testCaseId || undefined,
          testCaseName: r.testCaseName || undefined,
          endpoint: r.endpoint,
          method: r.method,
          statusCode: r.statusCode,
          statusCodeMatched: r.statusCodeMatched,
          contentTypeMatched: r.contentTypeMatched,
          contentType: r.contentType || undefined,
          requestUrl: r.requestUrl || undefined,
          requestErrors,
          responseErrors,
          commonRootCauses,
          durationMs: r.durationMs,
          retryCount: r.retryCount,
          recoveredAfterRetry: r.recoveredAfterRetry,
          isSlowEndpoint: r.isSlowEndpoint,
          _sourceResult: r,
        };
        return detail;
      });
  }

  private buildAttributionSummary(results: TestCaseResult[]): AttributionSummary {
    const failedResults = results.filter((r) => !r.valid);
    const totalFailures = failedResults.length;

    const categoryMap = new Map<FailureCategory, TestCaseResult[]>();
    const endpointFailMap = new Map<string, { total: number; failed: number }>();
    const messageMap = new Map<string, { count: number; paths: string[] }>();

    for (const r of failedResults) {
      const cat = categorizeTestCaseFailure(r);
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      categoryMap.get(cat)!.push(r);

      const epKey = `${r.method}:${r.endpoint}`;
      if (!endpointFailMap.has(epKey)) endpointFailMap.set(epKey, { total: 0, failed: 0 });
      const stats = endpointFailMap.get(epKey)!;
      stats.failed++;

      for (const err of [...r.requestErrors, ...r.responseErrors]) {
        if (!messageMap.has(err.message)) messageMap.set(err.message, { count: 0, paths: [] });
        const msgStat = messageMap.get(err.message)!;
        msgStat.count++;
        if (!msgStat.paths.includes(err.path)) msgStat.paths.push(err.path);
      }
    }

    for (const r of results) {
      const epKey = `${r.method}:${r.endpoint}`;
      if (!endpointFailMap.has(epKey)) endpointFailMap.set(epKey, { total: 0, failed: 0 });
      endpointFailMap.get(epKey)!.total++;
    }

    const byCategory: AttributionItem[] = [];
    for (const [cat, items] of categoryMap.entries()) {
      const meta = CATEGORY_META[cat];
      const errMap = new Map<string, { count: number; paths: string[] }>();
      for (const r of items) {
        for (const err of [...r.requestErrors, ...r.responseErrors]) {
          if (!errMap.has(err.message)) errMap.set(err.message, { count: 0, paths: [] });
          const stat = errMap.get(err.message)!;
          stat.count++;
          if (!stat.paths.includes(err.path)) stat.paths.push(err.path);
        }
      }
      const topErrors = Array.from(errMap.entries())
        .map(([message, s]) => ({ message, count: s.count, paths: s.paths.slice(0, 3) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      byCategory.push({
        category: cat,
        categoryLabel: meta.label,
        icon: meta.icon,
        count: items.length,
        percentage: totalFailures === 0 ? 0 : Math.round((items.length / totalFailures) * 100),
        testCases: items.map((r) => ({
          testCaseId: r.testCaseId,
          testCaseName: r.testCaseName,
          endpoint: r.endpoint,
          method: r.method,
          statusCode: r.statusCode,
          requestUrl: r.requestUrl,
          errorCount: r.requestErrors.length + r.responseErrors.length,
        })),
        topErrors,
      });
    }
    byCategory.sort((a, b) => b.count - a.count);

    const topEndpoints = Array.from(endpointFailMap.entries())
      .filter(([, s]) => s.failed > 0)
      .map(([key, s]) => {
        const [method, endpoint] = key.split(':', 2);
        const passRate = s.total === 0 ? 0 : Math.round(((s.total - s.failed) / s.total) * 10000) / 100;
        return { endpoint, method: method.toUpperCase(), failureCount: s.failed, passRate, total: s.total };
      })
      .sort((a, b) => b.failureCount - a.failureCount)
      .slice(0, 10);

    const topErrorMessages = Array.from(messageMap.entries())
      .map(([message, s]) => ({
        message,
        count: s.count,
        percentage: totalFailures === 0 ? 0 : Math.round((s.count / totalFailures) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { totalFailures, byCategory, topEndpoints, topErrorMessages };
  }

  private categorizeError(error: ValidationError): CategorizedError {
    const msg = error.message.toLowerCase();
    let category: ErrorCategory = 'other';

    if (msg.includes('required') || msg.includes('missing') || msg.includes('is missing')) {
      category = 'missing';
    } else if (msg.includes('expected type') || msg.includes('type mismatch') || (msg.includes('type') && !msg.includes('content-type'))) {
      category = 'type';
    } else if (msg.includes('format') || msg.includes('uuid') || msg.includes('email') || msg.includes('date') || msg.includes('url')) {
      category = 'format';
    } else if (msg.includes('enum') || msg.includes('allowed values') || msg.includes('one of')) {
      category = 'enum';
    } else if (msg.includes('minimum') || msg.includes('maximum') || msg.includes('minlength') || msg.includes('maxlength') || msg.includes('range')) {
      category = 'range';
    } else if (msg.includes('status') || msg.includes('unexpected response')) {
      category = 'status';
    } else if (msg.includes('content-type') || msg.includes('content type')) {
      category = 'content-type';
    }

    return {
      ...error,
      category,
      expected: error.expected,
      actual: error.actual,
      suggestions: this.generateSuggestions(error, category),
    };
  }

  private analyzeRootCauses(result: TestCaseResult): string[] {
    const causes: string[] = [];
    const allErrors = [...result.requestErrors, ...result.responseErrors];

    const typeErrorCount = allErrors.filter((e) =>
      e.message.includes('Expected type') || (e.message.includes('type') && !e.message.includes('content-type'))
    ).length;
    const missingCount = allErrors.filter((e) =>
      e.message.includes('Required') || e.message.includes('Missing') || e.message.includes('missing')
    ).length;
    const formatCount = allErrors.filter((e) =>
      e.message.includes('format') || e.message.includes('uuid') || e.message.includes('email') || e.message.includes('date')
    ).length;
    const enumCount = allErrors.filter((e) =>
      e.message.includes('enum') || e.message.includes('allowed values')
    ).length;

    if (!result.statusCodeMatched) causes.push('接口返回的状态码与契约定义不一致');
    if (!result.contentTypeMatched) causes.push('响应的 Content-Type 与契约声明不匹配');
    if (missingCount > 0) causes.push(`存在 ${missingCount} 处必填字段缺失`);
    if (typeErrorCount > 0) causes.push(`存在 ${typeErrorCount} 处字段类型错误`);
    if (formatCount > 0) causes.push(`存在 ${formatCount} 处数据格式校验失败`);
    if (enumCount > 0) causes.push(`存在 ${enumCount} 处枚举值不匹配`);
    if (result.recoveredAfterRetry) causes.push('首次请求失败，经重试后通过（偶发问题）');
    if (result.isSlowEndpoint) causes.push('接口响应较慢，已超过慢接口阈值');

    return causes;
  }

  private generateSuggestions(error: ValidationError, category: ErrorCategory): string[] {
    const suggestions: string[] = [];

    switch (category) {
      case 'missing':
        suggestions.push(`检查实际响应中是否缺少字段: "${error.path.split('.').pop()}"`);
        suggestions.push('确认后端实现是否正确输出了该字段，或检查契约是否应该标记为可选');
        break;
      case 'type':
        suggestions.push(`字段 "${error.path}" 类型不匹配，建议核对服务端序列化逻辑`);
        suggestions.push('确认前端期望的类型与后端实际返回类型一致');
        break;
      case 'format':
        suggestions.push(`字段 "${error.path}" 的格式不符合契约要求`);
        suggestions.push('检查数据生成逻辑是否使用了正确的格式规范');
        break;
      case 'enum':
        suggestions.push(`字段 "${error.path}" 的值不在枚举允许范围内`);
        suggestions.push('确认后端返回值是否在契约声明的枚举列表中');
        break;
      case 'range':
        suggestions.push(`字段 "${error.path}" 的值超出约束范围`);
        break;
      case 'status':
        suggestions.push('检查请求路径和参数是否正确，确认后端路由配置');
        break;
      case 'content-type':
        suggestions.push('检查后端是否正确设置 Content-Type 响应头');
        break;
    }

    if (error.path.startsWith('request')) {
      suggestions.push('建议先使用契约测试生成的请求示例发起请求，确认 request 格式');
    } else if (error.path.startsWith('response')) {
      suggestions.push('建议通过 curl 直接请求后端，对比 JSON 响应与契约 Schema');
    }

    return suggestions;
  }

  formatAsText(report: TestReport, options: { verbose?: boolean; includePassed?: boolean } = {}): string {
    const { verbose = false, includePassed = false } = options;
    const s = report.summary;
    const lines: string[] = [];

    lines.push('╔════════════════════════════════════════════════════════════════════╗');
    lines.push('║                    📋 契约测试汇总报告                             ║');
    lines.push('╠════════════════════════════════════════════════════════════════════╣');
    lines.push(`║ 生成时间:  ${this.padRight(report.generatedAt, 54)}║`);
    lines.push(`║ 用例总数:  ${this.padRight(String(s.total), 54)}║`);
    lines.push(`║ ✅ 通过:   ${this.padRight(String(s.passed), 54)}║`);
    lines.push(`║ ❌ 失败:   ${this.padRight(String(s.failed), 54)}║`);
    lines.push(`║ 📊 通过率: ${this.padRight(s.passRate + '%', 52)}║`);
    lines.push(`║ ⏱  总耗时: ${this.padRight(s.totalDurationMs + 'ms', 50)}║`);
    if (s.recoveredAfterRetry > 0) lines.push(`║ 🔄 重试通过: ${this.padRight(String(s.recoveredAfterRetry), 50)}║`);
    if (s.slowEndpoints > 0) lines.push(`║ 🐢 慢接口:   ${this.padRight(String(s.slowEndpoints), 50)}║`);
    lines.push('╠════════════════════════════════════════════════════════════════════╣');
    lines.push('║ 按 HTTP 方法 分组:                                                ║');
    for (const m of s.byMethod) {
      lines.push(`║   ${this.padRight(m.method, 8)} ${this.padRight(`${m.passed}/${m.total}`, 10)} (${m.passRate}%)${' '.repeat(32)}║`);
    }
    lines.push('╠════════════════════════════════════════════════════════════════════╣');
    lines.push('║ 按实际状态码 分组:                                                ║');
    for (const sc of s.byRealStatusCode) {
      const label = sc.statusCode === 0 ? '0 (网络错误)' : String(sc.statusCode);
      lines.push(`║   ${this.padRight(label, 12)} ${this.padRight(`${sc.passed}/${sc.total}`, 10)} (${sc.passRate}%)${' '.repeat(28)}║`);
    }
    lines.push('╠════════════════════════════════════════════════════════════════════╣');
    lines.push('║ 校验类型错误分布:                                                 ║');
    lines.push(`║   请求参数校验失败: ${this.padRight(String(s.byValidationType.requestValidation.failed), 44)}║`);
    lines.push(`║   响应体校验失败:   ${this.padRight(String(s.byValidationType.responseValidation.failed), 44)}║`);
    lines.push(`║   状态码校验失败:   ${this.padRight(String(s.byValidationType.statusCodeValidation.failed), 44)}║`);
    lines.push(`║   Content-Type:    ${this.padRight(String(s.byValidationType.contentTypeValidation.failed), 44)}║`);
    lines.push('╚════════════════════════════════════════════════════════════════════╝');

    if (report.attribution.totalFailures > 0) {
      lines.push('');
      lines.push('── 📊 失败归因汇总 Top 列表 ────────────────────────────────────────');
      for (let i = 0; i < report.attribution.byCategory.length; i++) {
        const a = report.attribution.byCategory[i];
        lines.push(`\n${i + 1}. ${a.icon} ${a.categoryLabel}: ${a.count} 个 (${a.percentage}%)`);
        for (const tc of a.testCases.slice(0, 5)) {
          lines.push(`   • ${tc.method.toUpperCase()} ${tc.endpoint} [${tc.statusCode}] ${tc.requestUrl || ''}`);
        }
        if (a.testCases.length > 5) lines.push(`   ... 还有 ${a.testCases.length - 5} 个用例`);
        if (a.topErrors.length > 0) {
          lines.push(`   常见错误:`);
          for (const te of a.topErrors.slice(0, 3)) {
            lines.push(`     - ${te.count}x ${te.message}`);
          }
        }
      }

      if (report.attribution.topEndpoints.length > 0) {
        lines.push('\n── 🔌 失败最多的端点 Top 10 ───────────────────────────────────────');
        for (let i = 0; i < report.attribution.topEndpoints.length; i++) {
          const ep = report.attribution.topEndpoints[i];
          lines.push(`  ${i + 1}. ${ep.method} ${ep.endpoint} - ${ep.failureCount}/${ep.total} 失败 (${ep.passRate}% 通过)`);
        }
      }
    }

    lines.push('');
    lines.push('── 按端点分组详情 ──────────────────────────────────────────────────');
    for (const g of report.endpoints) {
      const icon = g.failed === 0 ? '✅' : '❌';
      lines.push(`${icon} ${this.padRight(g.method, 6)} ${this.padRight(g.endpoint, 35)} ${g.passed}/${g.total} (${g.passRate}%)`);
      if (verbose) {
        for (const r of g.testCases) {
          if (!r.valid || includePassed) {
            const tIcon = r.valid ? '  ✓' : '  ✗';
            const name = r.testCaseName || '(未命名用例)';
            const urlInfo = r.requestUrl ? ` → ${r.requestUrl}` : '';
            const retryInfo = r.recoveredAfterRetry ? ` [重试${r.retryCount || 0}次后通过]` : '';
            const slowInfo = r.isSlowEndpoint ? ' [慢接口]' : '';
            lines.push(`${tIcon} ${name} [${r.statusCode}] ${r.durationMs || 0}ms${urlInfo}${retryInfo}${slowInfo}`);
            if (!r.valid) {
              for (const err of r.requestErrors) lines.push(`       📥 [${err.path}] ${err.message}`);
              for (const err of r.responseErrors) lines.push(`       📤 [${err.path}] ${err.message}`);
            }
          }
        }
      }
    }

    if (report.failedDetails.length > 0) {
      lines.push('');
      lines.push('── 失败用例详细分析 ────────────────────────────────────────────────');
      for (let i = 0; i < report.failedDetails.length; i++) {
        const d = report.failedDetails[i];
        lines.push(`\n【${i + 1}】${d.testCaseName || '(未命名)'} ${d.method.toUpperCase()} ${d.endpoint}`);
        const flags: string[] = [];
        if (d.recoveredAfterRetry) flags.push(`重试${d.retryCount || 0}次后通过`);
        if (d.isSlowEndpoint) flags.push('慢接口');
        const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
        lines.push(`    状态码: ${d.statusCode} (${d.statusCodeMatched ? '匹配' : '不匹配'}) | Content-Type: ${d.contentTypeMatched ? '匹配' : '不匹配'}${d.contentType ? ` (${d.contentType})` : ''}${flagStr}`);
        if (d.requestUrl) lines.push(`    请求地址: ${d.requestUrl}`);
        if (d.durationMs !== undefined) lines.push(`    耗时: ${d.durationMs}ms`);
        if (d.commonRootCauses.length > 0) {
          lines.push('    🔍 根因分析:');
          for (const cause of d.commonRootCauses) lines.push(`       • ${cause}`);
        }
        if (d.requestErrors.length > 0) {
          lines.push('    📥 请求校验错误:');
          for (const err of d.requestErrors) {
            lines.push(`       - [${err.category}] ${err.path}`);
            lines.push(`         ${err.message}`);
            if (err.expected !== undefined) lines.push(`         期望: ${this.truncateValue(err.expected)}`);
            if (err.actual !== undefined) lines.push(`         实际: ${this.truncateValue(err.actual)}`);
            const suggestions = err.suggestions || [];
            if (suggestions.length > 0) {
              lines.push(`         💡 建议:`);
              for (const sg of suggestions) lines.push(`            ${sg}`);
            }
          }
        }
        if (d.responseErrors.length > 0) {
          lines.push('    📤 响应校验错误:');
          for (const err of d.responseErrors) {
            lines.push(`       - [${err.category}] ${err.path}`);
            lines.push(`         ${err.message}`);
            if (err.expected !== undefined) lines.push(`         期望: ${this.truncateValue(err.expected)}`);
            if (err.actual !== undefined) lines.push(`         实际: ${this.truncateValue(err.actual)}`);
            const suggestions = err.suggestions || [];
            if (suggestions.length > 0) {
              lines.push(`         💡 建议:`);
              for (const sg of suggestions) lines.push(`            ${sg}`);
            }
          }
        }
      }
    }

    return lines.join('\n');
  }

  formatAsJSON(report: TestReport): string {
    return JSON.stringify(report, (key, value) => {
      if (key === 'filterFailedDetails' || key === '_sourceResult') return undefined;
      return value;
    }, 2);
  }

  formatAsHTML(report: TestReport, options: { title?: string } = {}): string {
    const s = report.summary;
    const title = options.title || '契约测试汇总报告';
    const overallColor = s.failed === 0 ? '#22c55e' : s.passRate >= 80 ? '#f59e0b' : '#ef4444';

    const endpointRows = report.endpoints
      .map((g) => {
        const color = g.failed === 0 ? 'pass' : 'fail';
        return `
          <tr class="${color}">
            <td><span class="method-tag method-${g.method.toLowerCase()}">${g.method}</span></td>
            <td class="endpoint-cell">${this.escapeHtml(g.endpoint)}</td>
            <td class="num">${g.total}</td>
            <td class="num">${g.passed}</td>
            <td class="num">${g.failed}</td>
            <td class="num">${g.passRate}%</td>
          </tr>`;
      })
      .join('');

    const statusCodeRows = s.byRealStatusCode
      .map((sc) => {
        const scClass = sc.failed === 0 ? 'pass' : (sc.statusCode >= 400 ? 'fail' : 'warn');
        const label = sc.statusCode === 0 ? '0 (网络错误)' : String(sc.statusCode);
        return `
          <tr class="${scClass}">
            <td class="num">${this.escapeHtml(label)}</td>
            <td class="num">${sc.total}</td>
            <td class="num">${sc.passed}</td>
            <td class="num">${sc.failed}</td>
            <td class="num">${sc.passRate}%</td>
          </tr>`;
      })
      .join('');

    const attributionHtml = report.attribution.totalFailures > 0 ? `
      <div class="card">
        <h2>📊 失败归因汇总</h2>
        ${report.attribution.byCategory.map((a) => `
          <div class="attribution-group">
            <div class="attribution-header">
              <span class="attribution-icon">${a.icon}</span>
              <span class="attribution-label">${this.escapeHtml(a.categoryLabel)}</span>
              <span class="attribution-count">${a.count} 个</span>
              <span class="attribution-pct">${a.percentage}%</span>
            </div>
            <div class="attribution-bar"><div class="attribution-bar-fill" style="width:${a.percentage}%"></div></div>
            ${a.testCases.length > 0 ? `
              <div class="attribution-tc-list">
                ${a.testCases.slice(0, 5).map((tc) => `
                  <div class="attribution-tc">
                    <span class="method-tag method-${tc.method.toLowerCase()}">${tc.method.toUpperCase()}</span>
                    <span class="atc-endpoint">${this.escapeHtml(tc.endpoint)}</span>
                    <span class="atc-status">${tc.statusCode}</span>
                    ${tc.requestUrl ? `<span class="atc-url">${this.escapeHtml(tc.requestUrl)}</span>` : ''}
                  </div>
                `).join('')}
                ${a.testCases.length > 5 ? `<div class="atc-more">还有 ${a.testCases.length - 5} 个用例...</div>` : ''}
              </div>
            ` : ''}
            ${a.topErrors.length > 0 ? `
              <div class="attribution-top-errs">
                <div class="section-subtitle">常见错误:</div>
                ${a.topErrors.map((te) => `
                  <div class="top-err">
                    <span class="te-count">${te.count}x</span>
                    <span class="te-msg">${this.escapeHtml(te.message)}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}

        ${report.attribution.topEndpoints.length > 0 ? `
          <div class="mt20">
            <div class="section-subtitle">🔌 失败最多的端点 Top ${report.attribution.topEndpoints.length}</div>
            <table>
              <thead><tr><th>方法</th><th>端点</th><th class="num">总数</th><th class="num">失败</th><th class="num">通过率</th></tr></thead>
              <tbody>
                ${report.attribution.topEndpoints.map((ep) => `
                  <tr class="fail">
                    <td><span class="method-tag method-${ep.method.toLowerCase()}">${ep.method}</span></td>
                    <td class="endpoint-cell">${this.escapeHtml(ep.endpoint)}</td>
                    <td class="num">${ep.total}</td>
                    <td class="num">${ep.failureCount}</td>
                    <td class="num">${ep.passRate}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}
      </div>
    ` : '';

    const failedCasesHtml = report.failedDetails
      .map((d, i) => {
        const errorsHtml = this.renderErrorsForHtml(d);
        const urlInfo = d.requestUrl ? `<span class="fc-url">${this.escapeHtml(d.requestUrl)}</span>` : '';
        const durationInfo = d.durationMs !== undefined ? `<span class="fc-duration">${d.durationMs}ms</span>` : '';
        const ctInfo = d.contentType ? `<span class="fc-ct">${this.escapeHtml(d.contentType)}</span>` : '';
        const retryInfo = d.recoveredAfterRetry ? `<span class="fc-retry">🔄 重试${d.retryCount || 0}次</span>` : '';
        const slowInfo = d.isSlowEndpoint ? `<span class="fc-slow">🐢 慢接口</span>` : '';
        return `
          <div class="failed-case" id="fc-${i}">
            <div class="failed-header" onclick="toggleFold('fc-body-${i}')">
              <span class="fc-index">#${i + 1}</span>
              <span class="fc-method method-${d.method.toLowerCase()}">${d.method.toUpperCase()}</span>
              <span class="fc-endpoint">${this.escapeHtml(d.endpoint)}</span>
              <span class="fc-name">${this.escapeHtml(d.testCaseName || '(未命名用例)')}</span>
              <span class="fc-status ${d.statusCodeMatched ? 'tag-green' : 'tag-red'}">${d.statusCode || 'N/A'}</span>
              ${urlInfo}${durationInfo}${ctInfo}${retryInfo}${slowInfo}
              <span class="fc-arrow">▼</span>
            </div>
            <div class="failed-body" id="fc-body-${i}">
              ${d.commonRootCauses.length > 0 ? `
                <div class="root-cause">
                  <div class="section-title">🔍 根因分析</div>
                  <ul>${d.commonRootCauses.map((c) => `<li>${this.escapeHtml(c)}</li>`).join('')}</ul>
                </div>` : ''}
              ${errorsHtml}
            </div>
          </div>`;
      })
      .join('');

    const filterBar = report.failedDetails.length > 0 ? `
      <div class="filter-bar">
        <span class="filter-label">过滤:</span>
        <button class="filter-btn active" onclick="filterFailed('all')">全部</button>
        <button class="filter-btn" onclick="filterFailed('request')">📥 请求侧</button>
        <button class="filter-btn" onclick="filterFailed('response')">📤 响应侧</button>
        <button class="filter-btn" onclick="filterFailed('status')">⚠️ 状态码不匹配</button>
        <button class="filter-btn" onclick="filterFailed('content-type')">🏷️ Content-Type</button>
        <button class="filter-btn" onclick="filterFailed('slow')">🐢 慢接口</button>
        <button class="filter-btn" onclick="filterFailed('retry')">🔄 重试后通过</button>
      </div>` : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; background: #f5f7fa; color: #333; }
    .container { max-width: 1280px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
    .card { background: #fff; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,.06); padding: 20px; margin-bottom: 20px; }
    .card h2 { margin: 0 0 16px; font-size: 17px; border-left: 4px solid #3b82f6; padding-left: 10px; }
    .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .stat-box { border-radius: 8px; padding: 16px; text-align: center; }
    .stat-box .label { font-size: 12px; color: #666; margin-bottom: 6px; }
    .stat-box .value { font-size: 26px; font-weight: 700; }
    .overall { background: ${overallColor}15; border: 1px solid ${overallColor}40; }
    .overall .value { color: ${overallColor}; }
    .passed-box { background: #22c55e15; border: 1px solid #22c55e40; }
    .passed-box .value { color: #16a34a; }
    .failed-box { background: #ef444415; border: 1px solid #ef444440; }
    .failed-box .value { color: #dc2626; }
    .duration-box { background: #3b82f615; border: 1px solid #3b82f640; }
    .duration-box .value { color: #2563eb; }
    .extra-box { background: #f59e0b15; border: 1px solid #f59e0b40; }
    .extra-box .value { color: #d97706; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eef0f4; font-size: 13px; }
    th { background: #f8fafc; font-weight: 600; color: #475569; }
    tr.pass { background: #f0fdf4; }
    tr.fail { background: #fef2f2; }
    tr.warn { background: #fffbeb; }
    .num { text-align: right; font-family: "SF Mono", Menlo, monospace; }
    .endpoint-cell { font-family: "SF Mono", Menlo, monospace; color: #1e40af; }
    .method-tag { display: inline-block; padding: 3px 10px; border-radius: 4px; font-weight: 700; font-size: 11px; color: #fff; min-width: 52px; text-align: center; }
    .method-get { background: #22c55e; } .method-post { background: #3b82f6; } .method-put { background: #f59e0b; } .method-delete { background: #ef4444; } .method-patch { background: #8b5cf6; }
    .method-head { background: #64748b; } .method-options { background: #64748b; }
    .validation-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .v-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
    .v-box .label { font-size: 12px; color: #64748b; }
    .v-box .count { font-size: 20px; font-weight: 700; margin-top: 4px; }
    .v-box .count.error { color: #dc2626; }
    .v-box .count.ok { color: #16a34a; }
    .filter-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .filter-label { font-weight: 600; color: #475569; font-size: 13px; }
    .filter-btn { padding: 5px 14px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; font-size: 12px; cursor: pointer; transition: all .15s; }
    .filter-btn:hover { background: #e0e7ff; border-color: #818cf8; }
    .filter-btn.active { background: #3b82f6; color: #fff; border-color: #3b82f6; }
    .failed-case { border: 1px solid #fecaca; border-radius: 8px; margin-bottom: 12px; overflow: hidden; background: #fef2f2; }
    .failed-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; background: #fecaca; flex-wrap: wrap; }
    .failed-header:hover { background: #fca5a5; }
    .fc-index { font-weight: 700; color: #991b1b; }
    .fc-method { color: #fff; }
    .fc-endpoint { font-family: "SF Mono", Menlo, monospace; font-weight: 600; color: #7f1d1d; }
    .fc-name { color: #444; flex: 1; min-width: 60px; }
    .fc-status { padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 12px; color: #fff; }
    .fc-url { font-family: "SF Mono", Menlo, monospace; font-size: 11px; color: #7f1d1d; background: #fee2e2; padding: 2px 6px; border-radius: 3px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fc-duration { font-size: 11px; color: #64748b; background: #f1f5f9; padding: 2px 6px; border-radius: 3px; }
    .fc-ct { font-size: 11px; color: #6d28d9; background: #ede9fe; padding: 2px 6px; border-radius: 3px; }
    .fc-retry { font-size: 11px; color: #047857; background: #d1fae5; padding: 2px 6px; border-radius: 3px; }
    .fc-slow { font-size: 11px; color: #92400e; background: #fef3c7; padding: 2px 6px; border-radius: 3px; }
    .tag-green { background: #22c55e; } .tag-red { background: #ef4444; }
    .fc-arrow { color: #7f1d1d; font-size: 11px; }
    .failed-body { padding: 16px 20px; border-top: 1px solid #fecaca; }
    .section-title { font-weight: 700; margin: 12px 0 8px; color: #7f1d1d; }
    .section-subtitle { font-weight: 600; margin: 12px 0 8px; color: #444; font-size: 14px; }
    .root-cause ul { margin: 4px 0; padding-left: 20px; }
    .root-cause li { margin: 4px 0; color: #444; }
    .err-group { background: #fff; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; border-left: 3px solid #ef4444; }
    .err-group .err-group-title { font-weight: 700; color: #991b1b; margin-bottom: 8px; font-size: 13px; }
    .err-item { padding: 8px 0; border-top: 1px dashed #fee2e2; }
    .err-item:first-child { border-top: none; }
    .err-category { display: inline-block; padding: 1px 8px; border-radius: 3px; font-size: 10px; font-weight: 700; color: #fff; margin-right: 6px; }
    .cat-type { background: #8b5cf6; } .cat-missing { background: #ef4444; } .cat-format { background: #f59e0b; } .cat-enum { background: #3b82f6; } .cat-range { background: #64748b; } .cat-status { background: #dc2626; } .cat-content-type { background: #d97706; } .cat-other { background: #9ca3af; }
    .err-path { font-family: "SF Mono", Menlo, monospace; color: #7c2d12; font-weight: 600; font-size: 13px; margin-bottom: 4px; }
    .err-msg { color: #444; font-size: 13px; margin-bottom: 6px; }
    .err-kv { display: grid; grid-template-columns: 80px 1fr; gap: 4px; font-size: 12px; margin: 4px 0; }
    .err-kv .k { color: #64748b; font-weight: 600; }
    .err-kv .v { font-family: "SF Mono", Menlo, monospace; background: #fef3c7; padding: 2px 6px; border-radius: 3px; color: #92400e; word-break: break-all; }
    .suggestions { background: #eff6ff; border-radius: 4px; padding: 8px 12px; margin-top: 8px; }
    .suggestions .s-title { font-size: 12px; color: #1e40af; font-weight: 600; margin-bottom: 4px; }
    .suggestions ul { margin: 0; padding-left: 18px; }
    .suggestions li { color: #1e3a8a; font-size: 12px; margin: 2px 0; }
    .hidden { display: none !important; }
    .mt20 { margin-top: 20px; }
    .attribution-group { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; background: #fafafa; }
    .attribution-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .attribution-icon { font-size: 18px; }
    .attribution-label { font-weight: 600; font-size: 14px; color: #1f2937; }
    .attribution-count { background: #ef4444; color: #fff; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; }
    .attribution-pct { color: #6b7280; font-size: 12px; margin-left: auto; }
    .attribution-bar { background: #e5e7eb; height: 6px; border-radius: 3px; overflow: hidden; margin-bottom: 10px; }
    .attribution-bar-fill { background: #ef4444; height: 100%; }
    .attribution-tc-list { margin: 8px 0; }
    .attribution-tc { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; flex-wrap: wrap; }
    .atc-endpoint { font-family: "SF Mono", Menlo, monospace; color: #1e40af; }
    .atc-status { color: #dc2626; font-weight: 700; }
    .atc-url { color: #64748b; font-family: "SF Mono", Menlo, monospace; font-size: 11px; background: #f1f5f9; padding: 1px 6px; border-radius: 3px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .atc-more { color: #64748b; font-size: 12px; font-style: italic; padding-left: 4px; }
    .attribution-top-errs { margin-top: 8px; }
    .top-err { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; }
    .te-count { background: #fbbf24; color: #fff; padding: 1px 8px; border-radius: 3px; font-weight: 700; font-size: 11px; min-width: 26px; text-align: center; }
    .te-msg { color: #374151; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${this.escapeHtml(title)}</h1>
    <div class="meta">生成时间: ${this.escapeHtml(report.generatedAt)}</div>

    <div class="card">
      <h2>📊 总览</h2>
      <div class="stat-grid">
        <div class="stat-box overall"><div class="label">通过率</div><div class="value">${s.passRate}%</div></div>
        <div class="stat-box passed-box"><div class="label">通过</div><div class="value">${s.passed}</div></div>
        <div class="stat-box failed-box"><div class="label">失败</div><div class="value">${s.failed}</div></div>
        <div class="stat-box duration-box"><div class="label">总耗时</div><div class="value">${s.totalDurationMs}ms</div></div>
      </div>
      <div class="stat-grid" style="grid-template-columns: repeat(4, 1fr); margin-top: 10px;">
        ${s.recoveredAfterRetry > 0 ? `<div class="stat-box extra-box"><div class="label">重试后通过</div><div class="value">${s.recoveredAfterRetry}</div></div>` : ''}
        ${s.slowEndpoints > 0 ? `<div class="stat-box extra-box"><div class="label">慢接口</div><div class="value">${s.slowEndpoints}</div></div>` : ''}
        ${s.recoveredAfterRetry === 0 && s.slowEndpoints === 0 ? '' : '<div></div><div></div>'}
      </div>
      <div class="validation-summary">
        <div class="v-box"><div class="label">请求参数校验失败</div><div class="count ${s.byValidationType.requestValidation.failed > 0 ? 'error' : 'ok'}">${s.byValidationType.requestValidation.failed}</div></div>
        <div class="v-box"><div class="label">响应体校验失败</div><div class="count ${s.byValidationType.responseValidation.failed > 0 ? 'error' : 'ok'}">${s.byValidationType.responseValidation.failed}</div></div>
        <div class="v-box"><div class="label">状态码校验失败</div><div class="count ${s.byValidationType.statusCodeValidation.failed > 0 ? 'error' : 'ok'}">${s.byValidationType.statusCodeValidation.failed}</div></div>
        <div class="v-box"><div class="label">Content-Type 失败</div><div class="count ${s.byValidationType.contentTypeValidation.failed > 0 ? 'error' : 'ok'}">${s.byValidationType.contentTypeValidation.failed}</div></div>
      </div>
    </div>

    <div class="card">
      <h2>🔢 按实际状态码分组</h2>
      <table>
        <thead><tr><th class="num">状态码</th><th class="num">总数</th><th class="num">通过</th><th class="num">失败</th><th class="num">通过率</th></tr></thead>
        <tbody>${statusCodeRows}</tbody>
      </table>
    </div>

    ${attributionHtml}

    <div class="card">
      <h2>🔌 按端点分组</h2>
      <table>
        <thead><tr><th>方法</th><th>端点</th><th class="num">总数</th><th class="num">通过</th><th class="num">失败</th><th class="num">通过率</th></tr></thead>
        <tbody>${endpointRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>❌ 失败用例详细分析 <span style="font-size:13px;color:#666;">(${report.failedDetails.length} 个)</span></h2>
      ${report.failedDetails.length === 0 ? '<p style="color:#16a34a;">🎉 所有用例均通过校验，干得漂亮！</p>' : `${filterBar}${failedCasesHtml}`}
    </div>
  </div>

  <script>
    function toggleFold(id) {
      const el = document.getElementById(id);
      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    function filterFailed(type) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      document.querySelectorAll('.failed-case').forEach(fc => {
        fc.classList.remove('hidden');
        if (type === 'all') return;
        const header = fc.querySelector('.failed-header');
        if (type === 'slow' && !header.querySelector('.fc-slow')) fc.classList.add('hidden');
        if (type === 'retry' && !header.querySelector('.fc-retry')) fc.classList.add('hidden');
        const hasReqErr = fc.querySelector('.err-group-title')?.textContent?.includes('请求');
        const hasRespErr = fc.querySelector('.err-group-title')?.textContent?.includes('响应');
        const statusTag = header?.querySelector('.fc-status');
        const isStatusMismatch = statusTag?.classList.contains('tag-red');
        if (type === 'request' && !hasReqErr) fc.classList.add('hidden');
        if (type === 'response' && !hasRespErr) fc.classList.add('hidden');
        if (type === 'status' && !isStatusMismatch) fc.classList.add('hidden');
        if (type === 'content-type') {
          const ctItems = fc.querySelectorAll('.err-category.cat-content-type');
          if (ctItems.length === 0) fc.classList.add('hidden');
        }
      });
    }
  </script>
</body>
</html>`;
  }

  private renderErrorsForHtml(d: FailedCaseDetail): string {
    const blocks: string[] = [];
    if (d.requestErrors.length > 0) {
      const items = d.requestErrors.map((e) => this.renderErrorItem(e)).join('');
      blocks.push(`<div class="err-group">
        <div class="err-group-title">📥 请求校验错误 (${d.requestErrors.length} 个)</div>
        ${items}
      </div>`);
    }
    if (d.responseErrors.length > 0) {
      const items = d.responseErrors.map((e) => this.renderErrorItem(e)).join('');
      blocks.push(`<div class="err-group">
        <div class="err-group-title">📤 响应校验错误 (${d.responseErrors.length} 个)</div>
        ${items}
      </div>`);
    }
    return blocks.join('');
  }

  private renderErrorItem(e: CategorizedError): string {
    const catClass = `cat-${e.category}`;
    const catLabel = {
      type: '类型', missing: '缺失', format: '格式', enum: '枚举',
      range: '范围', status: '状态码', 'content-type': 'CT', other: '其他',
    }[e.category] || '其他';
    const actual = e.actual !== undefined ? `<div class="err-kv"><span class="k">实际值</span><span class="v">${this.escapeHtml(this.truncateValue(e.actual))}</span></div>` : '';
    const expected = e.expected !== undefined ? `<div class="err-kv"><span class="k">期望值</span><span class="v">${this.escapeHtml(this.truncateValue(e.expected))}</span></div>` : '';
    const suggestions = e.suggestions && e.suggestions.length > 0
      ? `<div class="suggestions">
          <div class="s-title">💡 修复建议</div>
          <ul>${e.suggestions.map((s) => `<li>${this.escapeHtml(s)}</li>`).join('')}</ul>
        </div>`
      : '';
    return `<div class="err-item">
      <div class="err-path"><span class="err-category ${catClass}">${catLabel}</span>${this.escapeHtml(e.path)}</div>
      <div class="err-msg">${this.escapeHtml(e.message)}</div>
      ${actual}${expected}${suggestions}
    </div>`;
  }

  private truncateValue(v: any): string {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s.length > 120) return s.substring(0, 117) + '...';
    return s;
  }

  private padRight(s: string, n: number): string {
    if (s.length >= n) return s.substring(0, n);
    return s + ' '.repeat(n - s.length);
  }

  private escapeHtml(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}

function categorizeTestCaseFailure(result: TestCaseResult): FailureCategory {
  const status = result.statusCode;
  if (status === 0) return 'network_error';
  if (status === 401 || status === 403 || status === 407) return 'auth_error';
  if (!result.statusCodeMatched) return 'status_code_error';
  if (!result.contentTypeMatched) return 'content_type_error';
  if (result.requestErrors.length > 0) return 'request_validation_error';
  if (result.responseErrors.length > 0) return 'response_structure_error';
  return 'other_error';
}

export function generateTestReport(results: TestCaseResult[]): TestReport {
  return new TestReportGenerator().generateReport(results);
}

export function formatReport(
  report: TestReport,
  format: 'text' | 'json' | 'html' = 'text',
  options: any = {}
): string {
  const g = new TestReportGenerator();
  switch (format) {
    case 'json':
      return g.formatAsJSON(report);
    case 'html':
      return g.formatAsHTML(report, options);
    case 'text':
    default:
      return g.formatAsText(report, options);
  }
}



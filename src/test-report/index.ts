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
}

export interface SummaryStats {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  totalDurationMs: number;
  byMethod: MethodGroupStats[];
  byStatusCode: StatusCodeGroupStats[];
  byValidationType: ValidationTypeStats;
  failedEndpointsCount: number;
  totalEndpointsCount: number;
}

export interface MethodGroupStats {
  method: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

export interface StatusCodeGroupStats {
  statusCode: string;
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

export interface FailedCaseDetail {
  testCaseId?: string;
  testCaseName?: string;
  endpoint: string;
  method: string;
  statusCode: number;
  statusCodeMatched: boolean;
  contentTypeMatched: boolean;
  requestErrors: Array<ValidationError & { suggestions?: string[] }>;
  responseErrors: Array<ValidationError & { suggestions?: string[] }>;
  commonRootCauses: string[];
  durationMs?: number;
}

export interface TestReport {
  generatedAt: string;
  summary: SummaryStats;
  endpoints: EndpointGroupStats[];
  failedDetails: FailedCaseDetail[];
}

export class TestReportGenerator {
  generateReport(results: TestCaseResult[]): TestReport {
    return {
      generatedAt: new Date().toISOString(),
      summary: this.buildSummary(results),
      endpoints: this.buildEndpointGroups(results),
      failedDetails: this.buildFailedDetails(results),
    };
  }

  private buildSummary(results: TestCaseResult[]): SummaryStats {
    const total = results.length;
    const passed = results.filter((r) => r.valid).length;
    const failed = total - passed;
    const passRate = total === 0 ? 100 : Math.round((passed / total) * 10000) / 100;
    const totalDurationMs = results.reduce((s, r) => s + (r.durationMs || 0), 0);

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

    const scMap = new Map<string, TestCaseResult[]>();
    for (const r of results) {
      const key = r.statusCodeMatched ? '匹配' : '不匹配';
      if (!scMap.has(key)) scMap.set(key, []);
      scMap.get(key)!.push(r);
    }
    const byStatusCode: StatusCodeGroupStats[] = [];
    for (const [statusCode, items] of scMap.entries()) {
      const scPassed = items.filter((r) => r.valid).length;
      byStatusCode.push({
        statusCode,
        total: items.length,
        passed: scPassed,
        failed: items.length - scPassed,
        passRate: items.length === 0 ? 100 : Math.round((scPassed / items.length) * 10000) / 100,
      });
    }

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
      byStatusCode,
      byValidationType,
      failedEndpointsCount: failedEndpointKeys.size,
      totalEndpointsCount: endpointKeys.size,
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
        const requestErrors = r.requestErrors.map((e) => ({
          ...e,
          suggestions: this.generateSuggestions(e),
        }));
        const responseErrors = r.responseErrors.map((e) => ({
          ...e,
          suggestions: this.generateSuggestions(e),
        }));

        return {
          testCaseId: r.testCaseId,
          testCaseName: r.testCaseName,
          endpoint: r.endpoint,
          method: r.method,
          statusCode: r.statusCode,
          statusCodeMatched: r.statusCodeMatched,
          contentTypeMatched: r.contentTypeMatched,
          requestErrors,
          responseErrors,
          commonRootCauses,
          durationMs: r.durationMs,
        };
      });
  }

  private analyzeRootCauses(result: TestCaseResult): string[] {
    const causes: string[] = [];
    const allErrors = [...result.requestErrors, ...result.responseErrors];

    const typeErrorCount = allErrors.filter((e) =>
      e.message.includes('Expected type') || e.message.includes('type')
    ).length;
    const missingCount = allErrors.filter((e) =>
      e.message.includes('Required') || e.message.includes('Missing') || e.message.includes('missing')
    ).length;
    const formatCount = allErrors.filter((e) =>
      e.message.includes('format') || e.message.includes('uuid') || e.message.includes('email') || e.message.includes('date')
    ).length;

    if (!result.statusCodeMatched) causes.push('接口返回的状态码与契约定义不一致');
    if (!result.contentTypeMatched) causes.push('响应的 Content-Type 与契约声明不匹配');
    if (missingCount > 0) causes.push(`存在 ${missingCount} 处必填字段缺失`);
    if (typeErrorCount > 0) causes.push(`存在 ${typeErrorCount} 处字段类型错误`);
    if (formatCount > 0) causes.push(`存在 ${formatCount} 处数据格式校验失败`);

    return causes;
  }

  private generateSuggestions(error: ValidationError): string[] {
    const suggestions: string[] = [];
    const msg = error.message.toLowerCase();

    if (msg.includes('required') || msg.includes('missing')) {
      suggestions.push(`检查实际响应中是否缺少字段: "${error.path.split('.').pop()}"`);
      suggestions.push('确认后端实现是否正确输出了该字段，或检查契约是否应该标记为可选');
    } else if (msg.includes('expected type')) {
      suggestions.push(`字段 "${error.path}" 类型不匹配，建议核对服务端序列化逻辑`);
      suggestions.push('确认前端期望的类型与后端实际返回类型一致');
    } else if (msg.includes('format') || msg.includes('uuid') || msg.includes('email')) {
      suggestions.push(`字段 "${error.path}" 的格式不符合契约要求`);
      suggestions.push('检查数据生成逻辑是否使用了正确的格式规范');
    } else if (msg.includes('enum') || msg.includes('allowed values')) {
      suggestions.push(`字段 "${error.path}" 的值不在枚举允许范围内`);
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

    lines.push('╔══════════════════════════════════════════════════╗');
    lines.push('║            📋 契约测试汇总报告                   ║');
    lines.push('╠══════════════════════════════════════════════════╣');
    lines.push(`║ 生成时间: ${this.padRight(report.generatedAt, 32)}║`);
    lines.push(`║ 用例总数: ${this.padRight(String(s.total), 36)}║`);
    lines.push(`║ ✅ 通过: ${this.padRight(String(s.passed), 38)}║`);
    lines.push(`║ ❌ 失败: ${this.padRight(String(s.failed), 38)}║`);
    lines.push(`║ 📊 通过率: ${this.padRight(s.passRate + '%', 36)}║`);
    lines.push(`║ ⏱  总耗时: ${this.padRight(s.totalDurationMs + 'ms', 34)}║`);
    lines.push(`║ 🔗 涉及端点: ${this.padRight(`${s.failedEndpointsCount}/${s.totalEndpointsCount} 个失败`, 32)}║`);
    lines.push('╠══════════════════════════════════════════════════╣');
    lines.push('║ 按 HTTP 方法 分组:                               ║');
    for (const m of s.byMethod) {
      lines.push(`║   ${this.padRight(m.method, 8)} ${this.padRight(`${m.passed}/${m.total}`, 10)} (${m.passRate}%) ${' '.repeat(15)}║`);
    }
    lines.push('╠══════════════════════════════════════════════════╣');
    lines.push('║ 校验类型错误分布:                                ║');
    lines.push(`║   请求参数校验失败: ${this.padRight(String(s.byValidationType.requestValidation.failed), 24)}║`);
    lines.push(`║   响应体校验失败:  ${this.padRight(String(s.byValidationType.responseValidation.failed), 24)}║`);
    lines.push(`║   状态码校验失败:  ${this.padRight(String(s.byValidationType.statusCodeValidation.failed), 24)}║`);
    lines.push(`║   Content-Type:   ${this.padRight(String(s.byValidationType.contentTypeValidation.failed), 24)}║`);
    lines.push('╚══════════════════════════════════════════════════╝');

    lines.push('');
    lines.push('── 按端点分组详情 ──────────────────────────────────');
    for (const g of report.endpoints) {
      const icon = g.failed === 0 ? '✅' : '❌';
      lines.push(`${icon} ${this.padRight(g.method, 6)} ${this.padRight(g.endpoint, 35)} ${g.passed}/${g.total} (${g.passRate}%)`);
      if (verbose) {
        for (const r of g.testCases) {
          if (!r.valid || includePassed) {
            const tIcon = r.valid ? '  ✓' : '  ✗';
            const name = r.testCaseName || '(未命名用例)';
            lines.push(`${tIcon} ${name} [${r.statusCode}] ${r.durationMs || 0}ms`);
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
      lines.push('── 失败用例详细分析 ────────────────────────────────');
      for (let i = 0; i < report.failedDetails.length; i++) {
        const d = report.failedDetails[i];
        lines.push(`\n【${i + 1}】${d.testCaseName || '(未命名)'} ${d.method.toUpperCase()} ${d.endpoint}`);
        lines.push(`    状态码: ${d.statusCode} (${d.statusCodeMatched ? '匹配' : '不匹配'}) | Content-Type: ${d.contentTypeMatched ? '匹配' : '不匹配'}`);
        if (d.commonRootCauses.length > 0) {
          lines.push('    🔍 根因分析:');
          for (const cause of d.commonRootCauses) lines.push(`       • ${cause}`);
        }
        if (d.requestErrors.length > 0) {
          lines.push('    📥 请求校验错误:');
          for (const err of d.requestErrors) {
            lines.push(`       - 路径: ${err.path}`);
            lines.push(`         消息: ${err.message}`);
            if ('actual' in (err as any)) lines.push(`         实际值: ${JSON.stringify((err as any).actual)}`);
            if ('expected' in (err as any)) lines.push(`         期望值: ${JSON.stringify((err as any).expected)}`);
            const suggestions = (err as any).suggestions || [];
            if (suggestions.length > 0) {
              lines.push(`         💡 建议:`);
              for (const sg of suggestions) lines.push(`            ${sg}`);
            }
          }
        }
        if (d.responseErrors.length > 0) {
          lines.push('    📤 响应校验错误:');
          for (const err of d.responseErrors) {
            lines.push(`       - 路径: ${err.path}`);
            lines.push(`         消息: ${err.message}`);
            if ('actual' in (err as any)) lines.push(`         实际值: ${JSON.stringify((err as any).actual)}`);
            if ('expected' in (err as any)) lines.push(`         期望值: ${JSON.stringify((err as any).expected)}`);
            const suggestions = (err as any).suggestions || [];
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
    return JSON.stringify(report, null, 2);
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

    const failedCasesHtml = report.failedDetails
      .map((d, i) => {
        const errorsHtml = this.renderErrorsForHtml(d);
        return `
          <div class="failed-case" id="fc-${i}">
            <div class="failed-header" onclick="toggleFold('fc-body-${i}')">
              <span class="fc-index">#${i + 1}</span>
              <span class="fc-method method-${d.method.toLowerCase()}">${d.method.toUpperCase()}</span>
              <span class="fc-endpoint">${this.escapeHtml(d.endpoint)}</span>
              <span class="fc-name">${this.escapeHtml(d.testCaseName || '(未命名用例)')}</span>
              <span class="fc-status ${d.statusCodeMatched ? 'tag-green' : 'tag-red'}">${d.statusCode}</span>
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

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0; background: #f5f7fa; color: #333; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
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
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eef0f4; font-size: 13px; }
    th { background: #f8fafc; font-weight: 600; color: #475569; }
    tr.pass { background: #f0fdf4; }
    tr.fail { background: #fef2f2; }
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
    .failed-case { border: 1px solid #fecaca; border-radius: 8px; margin-bottom: 12px; overflow: hidden; background: #fef2f2; }
    .failed-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; background: #fecaca; }
    .failed-header:hover { background: #fca5a5; }
    .fc-index { font-weight: 700; color: #991b1b; }
    .fc-method { color: #fff; }
    .fc-endpoint { font-family: "SF Mono", Menlo, monospace; font-weight: 600; color: #7f1d1d; }
    .fc-name { color: #444; flex: 1; }
    .fc-status { padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 12px; color: #fff; }
    .tag-green { background: #22c55e; } .tag-red { background: #ef4444; }
    .fc-arrow { color: #7f1d1d; font-size: 11px; }
    .failed-body { padding: 16px 20px; border-top: 1px solid #fecaca; }
    .section-title { font-weight: 700; margin: 12px 0 8px; color: #7f1d1d; }
    .root-cause ul { margin: 4px 0; padding-left: 20px; }
    .root-cause li { margin: 4px 0; color: #444; }
    .err-group { background: #fff; border-radius: 6px; padding: 10px 14px; margin-bottom: 10px; border-left: 3px solid #ef4444; }
    .err-group .err-group-title { font-weight: 700; color: #991b1b; margin-bottom: 8px; font-size: 13px; }
    .err-item { padding: 8px 0; border-top: 1px dashed #fee2e2; }
    .err-item:first-child { border-top: none; }
    .err-path { font-family: "SF Mono", Menlo, monospace; color: #7c2d12; font-weight: 600; font-size: 13px; margin-bottom: 4px; }
    .err-msg { color: #444; font-size: 13px; margin-bottom: 6px; }
    .err-kv { display: grid; grid-template-columns: 80px 1fr; gap: 4px; font-size: 12px; margin: 4px 0; }
    .err-kv .k { color: #64748b; font-weight: 600; }
    .err-kv .v { font-family: "SF Mono", Menlo, monospace; background: #fef3c7; padding: 2px 6px; border-radius: 3px; color: #92400e; }
    .suggestions { background: #eff6ff; border-radius: 4px; padding: 8px 12px; margin-top: 8px; }
    .suggestions .s-title { font-size: 12px; color: #1e40af; font-weight: 600; margin-bottom: 4px; }
    .suggestions ul { margin: 0; padding-left: 18px; }
    .suggestions li { color: #1e3a8a; font-size: 12px; margin: 2px 0; }
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
      <div class="validation-summary">
        <div class="v-box"><div class="label">请求参数校验失败</div><div class="count ${s.byValidationType.requestValidation.failed > 0 ? 'error' : 'ok'}">${s.byValidationType.requestValidation.failed}</div></div>
        <div class="v-box"><div class="label">响应体校验失败</div><div class="count ${s.byValidationType.responseValidation.failed > 0 ? 'error' : 'ok'}">${s.byValidationType.responseValidation.failed}</div></div>
        <div class="v-box"><div class="label">状态码校验失败</div><div class="count ${s.byValidationType.statusCodeValidation.failed > 0 ? 'error' : 'ok'}">${s.byValidationType.statusCodeValidation.failed}</div></div>
        <div class="v-box"><div class="label">Content-Type 失败</div><div class="count ${s.byValidationType.contentTypeValidation.failed > 0 ? 'error' : 'ok'}">${s.byValidationType.contentTypeValidation.failed}</div></div>
      </div>
    </div>

    <div class="card">
      <h2>🔌 按端点分组</h2>
      <table>
        <thead><tr><th>方法</th><th>端点</th><th class="num">总数</th><th class="num">通过</th><th class="num">失败</th><th class="num">通过率</th></tr></thead>
        <tbody>${endpointRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>❌ 失败用例详细分析 <span style="font-size:13px;color:#666;">(${report.failedDetails.length} 个)</span></h2>
      ${report.failedDetails.length === 0 ? '<p style="color:#16a34a;">🎉 所有用例均通过校验，干得漂亮！</p>' : failedCasesHtml}
    </div>
  </div>

  <script>
    function toggleFold(id) {
      const el = document.getElementById(id);
      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
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

  private renderErrorItem(e: any): string {
    const actual = 'actual' in e ? `<div class="err-kv"><span class="k">实际值</span><span class="v">${this.escapeHtml(JSON.stringify(e.actual))}</span></div>` : '';
    const expected = 'expected' in e ? `<div class="err-kv"><span class="k">期望值</span><span class="v">${this.escapeHtml(JSON.stringify(e.expected))}</span></div>` : '';
    const suggestions = e.suggestions && e.suggestions.length > 0
      ? `<div class="suggestions">
          <div class="s-title">💡 修复建议</div>
          <ul>${e.suggestions.map((s: string) => `<li>${this.escapeHtml(s)}</li>`).join('')}</ul>
        </div>`
      : '';
    return `<div class="err-item">
      <div class="err-path">${this.escapeHtml(e.path)}</div>
      <div class="err-msg">${this.escapeHtml(e.message)}</div>
      ${actual}${expected}${suggestions}
    </div>`;
  }

  private padRight(s: string, n: number): string {
    if (s.length >= n) return s.substring(0, n);
    return s + ' '.repeat(n - s.length);
  }

  private escapeHtml(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
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

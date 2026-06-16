import * as fs from 'fs';
import * as path from 'path';
import { TestCaseResult, TestReport, SummaryStats } from '../test-report';

export interface CIHistoryContext {
  branch: string;
  commitHash: string;
  environment: string;
  buildNumber?: string;
  triggeredBy?: string;
}

export interface CIHistoryRecord {
  id: string;
  context: CIHistoryContext;
  timestamp: number;
  summary: SummaryStats;
  failedEndpoints: Array<{
    endpoint: string;
    method: string;
    statusCode: number;
    testCaseId?: string;
    testCaseName?: string;
    requestUrl?: string;
    errorCount: number;
  }>;
  passedEndpoints: Array<{
    endpoint: string;
    method: string;
    statusCode: number;
    testCaseId?: string;
    testCaseName?: string;
  }>;
  metadata?: {
    [key: string]: any;
  };
}

export interface TrendPoint {
  timestamp: number;
  commitHash: string;
  buildNumber?: string;
  passRate: number;
  total: number;
  passed: number;
  failed: number;
  recoveredAfterRetry: number;
  slowEndpoints: number;
}

export interface FailureDiffResult {
  newFailures: Array<{
    endpoint: string;
    method: string;
    statusCode: number;
    testCaseId?: string;
    testCaseName?: string;
    requestUrl?: string;
    errorCount: number;
    firstSeenAt: number;
    firstSeenCommit: string;
  }>;
  persistentFailures: Array<{
    endpoint: string;
    method: string;
    statusCode: number;
    testCaseId?: string;
    testCaseName?: string;
    requestUrl?: string;
    errorCount: number;
    failingSince: number;
    failingSinceCommit: string;
    consecutiveFailCount: number;
  }>;
  fixedFailures: Array<{
    endpoint: string;
    method: string;
    lastFailedAt: number;
    lastFailedCommit: string;
  }>;
}

export interface HistoryQueryOptions {
  branch?: string;
  environment?: string;
  limit?: number;
  before?: number;
  after?: number;
}

const HISTORY_FILE_NAME = 'ci-history.json';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

export class CIHistoryManager {
  private historyDir: string;
  private records: CIHistoryRecord[] = [];
  private lastTimestamp: number = 0;

  constructor(historyDir: string) {
    this.historyDir = path.resolve(historyDir);
    this.ensureHistoryDir();
    this.loadRecords();
    if (this.records.length > 0) {
      this.lastTimestamp = Math.max(...this.records.map((r) => r.timestamp));
    }
  }

  private ensureHistoryDir(): void {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  private getHistoryFilePath(): string {
    return path.join(this.historyDir, HISTORY_FILE_NAME);
  }

  private loadRecords(): void {
    const filePath = this.getHistoryFilePath();
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.records = JSON.parse(content);
      } catch (e) {
        this.records = [];
      }
    } else {
      this.records = [];
    }
  }

  private saveRecords(): void {
    const filePath = this.getHistoryFilePath();
    this.ensureHistoryDir();
    fs.writeFileSync(filePath, JSON.stringify(this.records, null, 2), 'utf-8');
  }

  addRecord(
    context: CIHistoryContext,
    report: TestReport,
    results: TestCaseResult[],
    metadata?: { [key: string]: any }
  ): CIHistoryRecord {
    const failedEndpoints = results
      .filter((r) => !r.valid)
      .map((r) => ({
        endpoint: r.endpoint,
        method: r.method,
        statusCode: r.statusCode,
        testCaseId: r.testCaseId,
        testCaseName: r.testCaseName,
        requestUrl: r.requestUrl,
        errorCount: r.requestErrors.length + r.responseErrors.length,
      }));

    const passedEndpoints = results
      .filter((r) => r.valid)
      .map((r) => ({
        endpoint: r.endpoint,
        method: r.method,
        statusCode: r.statusCode,
        testCaseId: r.testCaseId,
        testCaseName: r.testCaseName,
      }));

    let timestamp = Date.now();
    if (timestamp <= this.lastTimestamp) {
      timestamp = this.lastTimestamp + 1;
    }
    this.lastTimestamp = timestamp;

    const record: CIHistoryRecord = {
      id: generateId(),
      context: { ...context },
      timestamp,
      summary: { ...report.summary },
      failedEndpoints,
      passedEndpoints,
      metadata,
    };

    this.records.push(record);
    this.saveRecords();

    return record;
  }

  queryRecords(options: HistoryQueryOptions = {}): CIHistoryRecord[] {
    let filtered = [...this.records];

    if (options.branch) {
      filtered = filtered.filter((r) => r.context.branch === options.branch);
    }
    if (options.environment) {
      filtered = filtered.filter((r) => r.context.environment === options.environment);
    }
    if (options.before !== undefined) {
      filtered = filtered.filter((r) => r.timestamp < options.before!);
    }
    if (options.after !== undefined) {
      filtered = filtered.filter((r) => r.timestamp > options.after!);
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);

    if (options.limit !== undefined) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  getPassRateTrend(options: HistoryQueryOptions & { windowSize?: number } = {}): TrendPoint[] {
    const records = this.queryRecords({ ...options, limit: undefined });
    const windowSize = options.windowSize || 1;

    const sortedRecords = [...records].sort((a, b) => a.timestamp - b.timestamp);
    const trendPoints: TrendPoint[] = [];

    for (let i = 0; i < sortedRecords.length; i += windowSize) {
      const window = sortedRecords.slice(i, i + windowSize);
      if (window.length === 0) continue;

      const avgPassRate = window.reduce((sum, r) => sum + r.summary.passRate, 0) / window.length;
      const avgTotal = Math.round(window.reduce((sum, r) => sum + r.summary.total, 0) / window.length);
      const avgPassed = Math.round(window.reduce((sum, r) => sum + r.summary.passed, 0) / window.length);
      const avgFailed = Math.round(window.reduce((sum, r) => sum + r.summary.failed, 0) / window.length);
      const avgRecovered = Math.round(window.reduce((sum, r) => sum + (r.summary.recoveredAfterRetry || 0), 0) / window.length);
      const avgSlow = Math.round(window.reduce((sum, r) => sum + (r.summary.slowEndpoints || 0), 0) / window.length);

      const lastInWindow = window[window.length - 1];
      trendPoints.push({
        timestamp: lastInWindow.timestamp,
        commitHash: lastInWindow.context.commitHash,
        buildNumber: lastInWindow.context.buildNumber,
        passRate: Math.round(avgPassRate * 100) / 100,
        total: avgTotal,
        passed: avgPassed,
        failed: avgFailed,
        recoveredAfterRetry: avgRecovered,
        slowEndpoints: avgSlow,
      });
    }

    return trendPoints;
  }

  getFailureDiff(currentRecord: CIHistoryRecord, options: HistoryQueryOptions = {}): FailureDiffResult {
    const previousRecords = this.queryRecords({
      ...options,
      before: currentRecord.timestamp,
      limit: 20,
    });

    const endpointKey = (endpoint: string, method: string) => `${method.toUpperCase()} ${endpoint}`;

    const currentFailedKeys = new Set(
      currentRecord.failedEndpoints.map((f) => endpointKey(f.endpoint, f.method))
    );

    const historicalFailures = new Map<string, {
      lastFailedAt: number;
      lastFailedCommit: string;
      consecutiveCount: number;
      firstFailedAt: number;
      firstFailedCommit: string;
      totalFailCount: number;
    }>();

    for (let i = previousRecords.length - 1; i >= 0; i--) {
      const record = previousRecords[i];
      for (const fe of record.failedEndpoints) {
        const key = endpointKey(fe.endpoint, fe.method);
        const existing = historicalFailures.get(key);

        if (existing) {
          const prevRecord = previousRecords[i + 1];
          const prevFailedKeys = prevRecord
            ? new Set(prevRecord.failedEndpoints.map((f) => endpointKey(f.endpoint, f.method)))
            : new Set();

          if (prevFailedKeys.has(key)) {
            existing.consecutiveCount++;
          } else {
            existing.consecutiveCount = 1;
          }
          existing.lastFailedAt = record.timestamp;
          existing.lastFailedCommit = record.context.commitHash;
          existing.totalFailCount++;
        } else {
          historicalFailures.set(key, {
            lastFailedAt: record.timestamp,
            lastFailedCommit: record.context.commitHash,
            consecutiveCount: 1,
            firstFailedAt: record.timestamp,
            firstFailedCommit: record.context.commitHash,
            totalFailCount: 1,
          });
        }
      }
    }

    const newFailures: FailureDiffResult['newFailures'] = [];
    const persistentFailures: FailureDiffResult['persistentFailures'] = [];

    for (const fe of currentRecord.failedEndpoints) {
      const key = endpointKey(fe.endpoint, fe.method);
      const history = historicalFailures.get(key);

      if (!history) {
        newFailures.push({
          ...fe,
          firstSeenAt: currentRecord.timestamp,
          firstSeenCommit: currentRecord.context.commitHash,
        });
      } else {
        const prevRecord = previousRecords[0];
        const prevFailedKeys = prevRecord
          ? new Set(prevRecord.failedEndpoints.map((f) => endpointKey(f.endpoint, f.method)))
          : new Set();
        const consecutiveCount = prevFailedKeys.has(key) ? history.consecutiveCount + 1 : 1;

        persistentFailures.push({
          ...fe,
          failingSince: history.firstFailedAt,
          failingSinceCommit: history.firstFailedCommit,
          consecutiveFailCount: consecutiveCount,
        });
      }
    }

    const fixedFailures: FailureDiffResult['fixedFailures'] = [];
    const lastFailedKeys = historicalFailures.size > 0 ? new Set(historicalFailures.keys()) : new Set();
    for (const [key, history] of historicalFailures) {
      if (!currentFailedKeys.has(key) && lastFailedKeys.has(key)) {
        const [method, ...endpointParts] = key.split(' ');
        const endpoint = endpointParts.join(' ');
        fixedFailures.push({
          endpoint,
          method: method.toLowerCase(),
          lastFailedAt: history.lastFailedAt,
          lastFailedCommit: history.lastFailedCommit,
        });
      }
    }

    return { newFailures, persistentFailures, fixedFailures };
  }

  getLatestRecord(options?: HistoryQueryOptions): CIHistoryRecord | undefined {
    const records = this.queryRecords({ ...options, limit: 1 });
    return records[0];
  }

  deleteRecord(recordId: string): boolean {
    const index = this.records.findIndex((r) => r.id === recordId);
    if (index !== -1) {
      this.records.splice(index, 1);
      this.saveRecords();
      return true;
    }
    return false;
  }

  clearHistory(): void {
    this.records = [];
    this.saveRecords();
  }

  getAllRecords(): CIHistoryRecord[] {
    return [...this.records].sort((a, b) => b.timestamp - a.timestamp);
  }

  getStats(options?: HistoryQueryOptions): {
    totalRuns: number;
    averagePassRate: number;
    bestPassRate: number;
    worstPassRate: number;
    streak: { current: number; longest: number; type: 'passing' | 'failing' | 'none' };
  } {
    const records = this.queryRecords(options);
    const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);

    if (sorted.length === 0) {
      return {
        totalRuns: 0,
        averagePassRate: 0,
        bestPassRate: 0,
        worstPassRate: 0,
        streak: { current: 0, longest: 0, type: 'none' },
      };
    }

    const passRates = sorted.map((r) => r.summary.passRate);
    const averagePassRate = passRates.reduce((a, b) => a + b, 0) / passRates.length;

    let currentStreak = 0;
    let longestStreak = 0;
    let streakType: 'passing' | 'failing' | 'none' = 'none';
    let currentType: 'passing' | 'failing' | null = null;

    for (const r of sorted) {
      const isPassing = r.summary.failed === 0;
      const thisType = isPassing ? 'passing' : 'failing';

      if (thisType === currentType) {
        currentStreak++;
      } else {
        currentStreak = 1;
        currentType = thisType;
      }

      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
        streakType = thisType;
      }
    }

    return {
      totalRuns: records.length,
      averagePassRate: Math.round(averagePassRate * 100) / 100,
      bestPassRate: Math.max(...passRates),
      worstPassRate: Math.min(...passRates),
      streak: {
        current: currentStreak,
        longest: longestStreak,
        type: currentType || 'none',
      },
    };
  }
}

export function createCIHistoryManager(historyDir: string): CIHistoryManager {
  return new CIHistoryManager(historyDir);
}

export function formatTrendAsText(trend: TrendPoint[]): string {
  if (trend.length === 0) return '无历史数据';

  const lines: string[] = ['── 通过率趋势 ──────────────────────────────────────────'];
  lines.push(`${'时间'.padEnd(20)} ${'提交'.padEnd(10)} ${'通过率'.padEnd(10)} ${'通过/失败'.padEnd(12)} ${'重试恢复'.padEnd(8)} ${'慢接口'.padEnd(8)}`);
  lines.push('─'.repeat(80));

  for (const p of trend.slice(-20)) {
    const date = new Date(p.timestamp);
    const dateStr = date.toLocaleString('zh-CN', { hour12: false });
    const commitShort = p.commitHash.substring(0, 8);
    const passRateStr = `${p.passRate.toFixed(1)}%`;
    const resultStr = `${p.passed}/${p.failed}`;

    let icon = '✅';
    if (p.passRate < 50) icon = '🔴';
    else if (p.passRate < 80) icon = '🟡';
    else if (p.passRate < 100) icon = '🟢';

    lines.push(
      `${dateStr.padEnd(20)} ${commitShort.padEnd(10)} ${passRateStr.padEnd(10)} ${resultStr.padEnd(12)} ${String(p.recoveredAfterRetry).padEnd(8)} ${String(p.slowEndpoints).padEnd(8)} ${icon}`
    );
  }

  return lines.join('\n');
}

export function formatFailureDiffAsText(diff: FailureDiffResult): string {
  const lines: string[] = [];

  if (diff.newFailures.length > 0) {
    lines.push('');
    lines.push('🆕 本次新增失败:');
    for (const f of diff.newFailures) {
      lines.push(`  ${f.method.toUpperCase()} ${f.endpoint} - ${f.statusCode} (${f.errorCount} 个错误)`);
      if (f.requestUrl) lines.push(`     ${f.requestUrl}`);
    }
  }

  if (diff.persistentFailures.length > 0) {
    lines.push('');
    lines.push('🔄 历史持续失败:');
    for (const f of diff.persistentFailures) {
      const since = new Date(f.failingSince).toLocaleString('zh-CN', { hour12: false });
      lines.push(`  ${f.method.toUpperCase()} ${f.endpoint} - ${f.statusCode} - 连续失败 ${f.consecutiveFailCount} 次 (从 ${since} 开始)`);
      if (f.requestUrl) lines.push(`     ${f.requestUrl}`);
    }
  }

  if (diff.fixedFailures.length > 0) {
    lines.push('');
    lines.push('✅ 已修复:');
    for (const f of diff.fixedFailures) {
      const when = new Date(f.lastFailedAt).toLocaleString('zh-CN', { hour12: false });
      lines.push(`  ${f.method.toUpperCase()} ${f.endpoint} - 上次失败: ${when}`);
    }
  }

  if (diff.newFailures.length === 0 && diff.persistentFailures.length === 0 && diff.fixedFailures.length === 0) {
    lines.push('✅ 无失败用例，全部通过');
  }

  return lines.join('\n');
}

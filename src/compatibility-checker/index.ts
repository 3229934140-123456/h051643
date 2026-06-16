import {
  ApiModel,
  Endpoint,
  CompatibilityResult,
  BreakingChange,
  NonBreakingChange,
  SchemaObject,
  ParameterObject,
  ResponseObject,
  ObjectSchema,
  ArraySchema,
} from '../types';

export class CompatibilityChecker {
  private breakingChanges: BreakingChange[] = [];
  private nonBreakingChanges: NonBreakingChange[] = [];

  check(oldSpec: ApiModel, newSpec: ApiModel): CompatibilityResult {
    this.breakingChanges = [];
    this.nonBreakingChanges = [];

    this.checkEndpoints(oldSpec, newSpec);
    this.checkSchemas(oldSpec, newSpec);

    return {
      isCompatible: this.breakingChanges.length === 0,
      breakingChanges: this.breakingChanges,
      nonBreakingChanges: this.nonBreakingChanges,
    };
  }

  private checkEndpoints(oldSpec: ApiModel, newSpec: ApiModel): void {
    const oldEndpoints = new Map<string, Endpoint>();
    const newEndpoints = new Map<string, Endpoint>();

    for (const ep of oldSpec.endpoints) {
      oldEndpoints.set(`${ep.method}:${ep.path}`, ep);
    }
    for (const ep of newSpec.endpoints) {
      newEndpoints.set(`${ep.method}:${ep.path}`, ep);
    }

    for (const [key, oldEp] of oldEndpoints) {
      const newEp = newEndpoints.get(key);
      if (!newEp) {
        this.addBreakingChange('removed-endpoint', oldEp.path, oldEp.method, `Endpoint removed: ${oldEp.method.toUpperCase()} ${oldEp.path}`);
      } else {
        this.checkEndpointCompatibility(oldEp, newEp);
      }
    }

    for (const [key, newEp] of newEndpoints) {
      if (!oldEndpoints.has(key)) {
        this.addNonBreakingChange('added-endpoint', newEp.path, newEp.method, `New endpoint added: ${newEp.method.toUpperCase()} ${newEp.path}`);
      }
    }
  }

  private checkEndpointCompatibility(oldEp: Endpoint, newEp: Endpoint): void {
    this.checkParameters(oldEp, newEp);
    this.checkRequestBodies(oldEp, newEp);
    this.checkResponses(oldEp, newEp);
  }

  private checkParameters(oldEp: Endpoint, newEp: Endpoint): void {
    const oldParams = new Map<string, ParameterObject>();
    const newParams = new Map<string, ParameterObject>();

    for (const p of oldEp.parameters) {
      oldParams.set(`${p.in}:${p.name}`, p);
    }
    for (const p of newEp.parameters) {
      newParams.set(`${p.in}:${p.name}`, p);
    }

    for (const [key, oldParam] of oldParams) {
      const newParam = newParams.get(key);
      if (!newParam) {
        if (oldParam.required) {
          this.addBreakingChange(
            'removed-parameter',
            oldEp.path,
            oldEp.method,
            `Required parameter removed: ${oldParam.name} (in ${oldParam.in})`,
          );
        } else {
          this.addNonBreakingChange(
            'added-parameter',
            oldEp.path,
            oldEp.method,
            `Optional parameter removed: ${oldParam.name} (in ${oldParam.in})`,
          );
        }
      } else {
        this.checkParameterCompatibility(oldParam, newParam, oldEp.path, oldEp.method);
      }
    }

    for (const [key, newParam] of newParams) {
      if (!oldParams.has(key)) {
        if (newParam.required) {
          this.addBreakingChange(
            'added-required',
            oldEp.path,
            oldEp.method,
            `New required parameter added: ${newParam.name} (in ${newParam.in})`,
          );
        } else {
          this.addNonBreakingChange(
            'added-parameter',
            oldEp.path,
            oldEp.method,
            `New optional parameter added: ${newParam.name} (in ${newParam.in})`,
          );
        }
      }
    }
  }

  private checkParameterCompatibility(
    oldParam: ParameterObject,
    newParam: ParameterObject,
    path: string,
    method: string,
  ): void {
    if (oldParam.required && !newParam.required) {
      this.addNonBreakingChange(
        'added-parameter',
        path,
        method,
        `Parameter "${oldParam.name}" changed from required to optional`,
      );
    }
    if (!oldParam.required && newParam.required) {
      this.addBreakingChange(
        'changed-required',
        path,
        method,
        `Parameter "${oldParam.name}" changed from optional to required`,
      );
    }

    if (oldParam.schema && newParam.schema) {
      this.checkSchemaCompatibility(
        oldParam.schema,
        newParam.schema,
        `parameter.${oldParam.name}`,
        path,
        method,
        false,
      );
    }
  }

  private checkRequestBodies(oldEp: Endpoint, newEp: Endpoint): void {
    const oldBody = oldEp.requestBody;
    const newBody = newEp.requestBody;

    if (!oldBody && newBody) {
      if (newBody.required) {
        this.addBreakingChange(
          'added-required',
          oldEp.path,
          oldEp.method,
          'New required request body added',
        );
      }
      return;
    }

    if (oldBody && !newBody) {
      this.addNonBreakingChange(
        'added-endpoint',
        oldEp.path,
        oldEp.method,
        'Request body removed',
      );
      return;
    }

    if (oldBody && newBody) {
      if (oldBody.required && !newBody.required) {
        this.addNonBreakingChange(
          'added-endpoint',
          oldEp.path,
          oldEp.method,
          'Request body changed from required to optional',
        );
      }
      if (!oldBody.required && newBody.required) {
        this.addBreakingChange(
          'changed-required',
          oldEp.path,
          oldEp.method,
          'Request body changed from optional to required',
        );
      }

      const oldSchema = oldBody.content?.['application/json']?.schema;
      const newSchema = newBody.content?.['application/json']?.schema;

      if (oldSchema && newSchema) {
        this.checkSchemaCompatibility(oldSchema, newSchema, 'requestBody', oldEp.path, oldEp.method, false);
      }
    }
  }

  private checkResponses(oldEp: Endpoint, newEp: Endpoint): void {
    const oldResponses = oldEp.responses;
    const newResponses = newEp.responses;

    for (const [statusCode, oldResponse] of Object.entries(oldResponses)) {
      const newResponse = newResponses[statusCode];
      if (!newResponse) {
        this.addBreakingChange(
          'removed-endpoint',
          oldEp.path,
          oldEp.method,
          `Response ${statusCode} removed`,
        );
      } else {
        this.checkResponseCompatibility(oldResponse, newResponse, statusCode, oldEp.path, oldEp.method);
      }
    }

    for (const [statusCode] of Object.entries(newResponses)) {
      if (!oldResponses[statusCode]) {
        this.addNonBreakingChange(
          'added-response',
          oldEp.path,
          oldEp.method,
          `New response status ${statusCode} added`,
        );
      }
    }
  }

  private checkResponseCompatibility(
    oldResponse: ResponseObject,
    newResponse: ResponseObject,
    statusCode: string,
    path: string,
    method: string,
  ): void {
    const oldSchema = oldResponse.content?.['application/json']?.schema;
    const newSchema = newResponse.content?.['application/json']?.schema;

    if (oldSchema && newSchema) {
      this.checkSchemaCompatibility(oldSchema, newSchema, `response.${statusCode}`, path, method, true);
    }
  }

  private checkSchemaCompatibility(
    oldSchema: SchemaObject,
    newSchema: SchemaObject,
    basePath: string,
    endpointPath: string,
    method: string | undefined,
    isResponse: boolean,
  ): void {
    const oldType = this.getSchemaType(oldSchema);
    const newType = this.getSchemaType(newSchema);

    if (oldType && newType && oldType !== newType) {
      this.addBreakingChange(
        'changed-type',
        endpointPath,
        method,
        `${basePath}: type changed from ${oldType} to ${newType}`,
        oldType,
        newType,
      );
      return;
    }

    if (oldType === 'object' && newType === 'object') {
      this.checkObjectSchemaCompatibility(
        oldSchema as ObjectSchema,
        newSchema as ObjectSchema,
        basePath,
        endpointPath,
        method,
        isResponse,
      );
    }

    if (oldType === 'array' && newType === 'array') {
      const oldItems = (oldSchema as ArraySchema).items;
      const newItems = (newSchema as ArraySchema).items;
      if (oldItems && newItems) {
        this.checkSchemaCompatibility(oldItems, newItems, `${basePath}.items`, endpointPath, method, isResponse);
      }
    }
  }

  private checkObjectSchemaCompatibility(
    oldSchema: ObjectSchema,
    newSchema: ObjectSchema,
    basePath: string,
    endpointPath: string,
    method: string | undefined,
    isResponse: boolean,
  ): void {
    const oldProps = oldSchema.properties || {};
    const newProps = newSchema.properties || {};
    const oldRequired = new Set(oldSchema.required || []);
    const newRequired = new Set(newSchema.required || []);

    for (const [propName, oldPropSchema] of Object.entries(oldProps)) {
      const newPropSchema = newProps[propName];

      if (!newPropSchema) {
        if (oldRequired.has(propName)) {
          this.addBreakingChange(
            'removed-property',
            endpointPath,
            method,
            `${basePath}: required property "${propName}" removed`,
          );
        } else if (isResponse) {
          this.addBreakingChange(
            'removed-property',
            endpointPath,
            method,
            `${basePath}: response property "${propName}" removed`,
          );
        }
        continue;
      }

      const wasRequired = oldRequired.has(propName);
      const isNowRequired = newRequired.has(propName);

      if (wasRequired && !isNowRequired && !isResponse) {
        this.addNonBreakingChange(
          'added-property',
          endpointPath,
          method,
          `${basePath}: property "${propName}" changed from required to optional`,
        );
      }

      if (!wasRequired && isNowRequired && !isResponse) {
        this.addBreakingChange(
          'changed-required',
          endpointPath,
          method,
          `${basePath}: property "${propName}" changed from optional to required`,
        );
      }

      this.checkSchemaCompatibility(
        oldPropSchema,
        newPropSchema,
        `${basePath}.${propName}`,
        endpointPath,
        method,
        isResponse,
      );
    }

    for (const [propName] of Object.entries(newProps)) {
      if (!oldProps[propName]) {
        if (newRequired.has(propName) && !isResponse) {
          this.addBreakingChange(
            'added-required',
            endpointPath,
            method,
            `${basePath}: new required property "${propName}" added`,
          );
        } else {
          this.addNonBreakingChange(
            'added-property',
            endpointPath,
            method,
            `${basePath}: new property "${propName}" added`,
          );
        }
      }
    }
  }

  private checkSchemas(oldSpec: ApiModel, newSpec: ApiModel): void {
    const oldSchemas = oldSpec.schemas || {};
    const newSchemas = newSpec.schemas || {};

    for (const [name, oldSchema] of Object.entries(oldSchemas)) {
      const newSchema = newSchemas[name];
      if (!newSchema) {
        this.addBreakingChange(
          'removed-property',
          `#/components/schemas/${name}`,
          undefined,
          `Schema "${name}" removed`,
        );
      } else {
        this.checkSchemaCompatibility(
          oldSchema,
          newSchema,
          `schemas.${name}`,
          `#/components/schemas/${name}`,
          undefined,
          true,
        );
      }
    }

    for (const [name] of Object.entries(newSchemas)) {
      if (!oldSchemas[name]) {
        this.addNonBreakingChange(
          'added-property',
          `#/components/schemas/${name}`,
          undefined,
          `New schema "${name}" added`,
        );
      }
    }
  }

  private getSchemaType(schema: SchemaObject): string | undefined {
    if ('type' in schema) {
      return schema.type as string;
    }
    if ('allOf' in schema || 'anyOf' in schema || 'oneOf' in schema) {
      return 'object';
    }
    return undefined;
  }

  private addBreakingChange(
    type: BreakingChange['type'],
    path: string,
    method: string | undefined,
    message: string,
    oldValue?: any,
    newValue?: any,
  ): void {
    const change: any = {
      type,
      path,
      message,
      oldValue,
      newValue,
    };
    if (method !== undefined) {
      change.method = method;
    }
    this.breakingChanges.push(change as BreakingChange);
  }

  private addNonBreakingChange(
    type: NonBreakingChange['type'],
    path: string,
    method: string | undefined,
    message: string,
  ): void {
    const change: any = {
      type,
      path,
      message,
    };
    if (method !== undefined) {
      change.method = method;
    }
    this.nonBreakingChanges.push(change as NonBreakingChange);
  }

  classifyChanges(result: CompatibilityResult): ClassifiedCompatibilityResult {
    const requestSideBreaking: BreakingChange[] = [];
    const responseSideBreaking: BreakingChange[] = [];
    const unclearBreaking: BreakingChange[] = [];
    const addedFields: NonBreakingChange[] = [];
    const otherNonBreaking: NonBreakingChange[] = [];

    for (const change of result.breakingChanges) {
      const classified = this.classifyBreakingChange(change);
      switch (classified) {
        case 'request':
          requestSideBreaking.push(change);
          break;
        case 'response':
          responseSideBreaking.push(change);
          break;
        default:
          unclearBreaking.push(change);
      }
    }

    for (const change of result.nonBreakingChanges) {
      if (change.type === 'added-property' || change.type === 'added-parameter') {
        addedFields.push(change);
      } else {
        otherNonBreaking.push(change);
      }
    }

    const totalBreaking = result.breakingChanges.length;
    const totalNonBreaking = result.nonBreakingChanges.length;

    let severityLevel: 'safe' | 'warn' | 'danger' = 'safe';
    if (totalBreaking > 0) {
      if (requestSideBreaking.length > 0) {
        severityLevel = 'danger';
      } else {
        severityLevel = 'warn';
      }
    }

    const exitCode = this.determineExitCode(result, severityLevel);

    return {
      ...result,
      classification: {
        requestSideBreaking,
        responseSideBreaking,
        unclearBreaking,
        addedFields,
        otherNonBreaking,
      },
      summary: {
        totalBreaking,
        totalNonBreaking,
        requestSideBreakingCount: requestSideBreaking.length,
        responseSideBreakingCount: responseSideBreaking.length,
        addedFieldsCount: addedFields.length,
      },
      severityLevel,
      exitCode,
      recommendations: this.generateRecommendations(
        result,
        severityLevel,
        requestSideBreaking.length,
        responseSideBreaking.length,
      ),
    };
  }

  private classifyBreakingChange(change: BreakingChange): 'request' | 'response' | 'unclear' {
    const msg = change.message.toLowerCase();
    const pathStr = change.path.toLowerCase();

    if (change.type === 'removed-endpoint') {
      return 'unclear';
    }

    if (change.type === 'removed-parameter' || change.type === 'changed-required' || change.type === 'added-required') {
      if (msg.includes('parameter') || msg.includes('request body') || msg.includes('requestbody')) {
        return 'request';
      }
      if (change.type === 'removed-parameter') {
        return 'request';
      }
    }

    if (msg.includes('request') || msg.includes('parameter') || pathStr.includes('parameter')) {
      return 'request';
    }

    if (msg.includes('response') || msg.includes('response property') || pathStr.includes('response')) {
      return 'response';
    }

    if (change.type === 'removed-property' || change.type === 'changed-type') {
      if (msg.includes('response')) {
        return 'response';
      }
      if (pathStr.includes('schemas')) {
        return 'unclear';
      }
    }

    return 'unclear';
  }

  private determineExitCode(result: CompatibilityResult, severity: 'safe' | 'warn' | 'danger'): number {
    if (severity === 'danger') {
      return 2;
    }
    if (severity === 'warn' || result.breakingChanges.length > 0) {
      return 1;
    }
    return 0;
  }

  private generateRecommendations(
    result: CompatibilityResult,
    severity: string,
    requestBreaking: number,
    responseBreaking: number,
  ): string[] {
    const recs: string[] = [];

    if (requestBreaking > 0) {
      recs.push('❌ 请求侧存在破坏性变更，客户端代码必须更新才能兼容');
      recs.push('   建议：修改客户端代码，或回滚服务端变更');
    }

    if (responseBreaking > 0 && requestBreaking === 0) {
      recs.push('⚠️ 响应侧存在破坏性变更（删除字段/改类型）');
      recs.push('   建议：确认客户端是否依赖被删除/修改的字段');
    }

    const endpointRemovals = result.breakingChanges.filter((c) => c.type === 'removed-endpoint');
    if (endpointRemovals.length > 0) {
      recs.push(`⚠️ ${endpointRemovals.length} 个端点被删除，请检查调用方是否还在使用`);
    }

    const reqAdditions = result.breakingChanges.filter(
      (c) => c.type === 'added-required' || c.type === 'changed-required',
    );
    if (reqAdditions.length > 0) {
      recs.push(`❌ ${reqAdditions.length} 处新增必填参数/字段，旧客户端调用会失败`);
    }

    if (severity === 'safe') {
      recs.push('✅ 未检测到破坏性变更，可以安全发布');
    }

    if (result.nonBreakingChanges.length > 0) {
      const addedCount = result.nonBreakingChanges.filter(
        (c) => c.type === 'added-property' || c.type === 'added-parameter' || c.type === 'added-endpoint',
      ).length;
      if (addedCount > 0) {
        recs.push(`ℹ️ 新增了 ${addedCount} 个接口/字段/参数（非破坏性）`);
      }
    }

    return recs;
  }

  formatResult(
    classified: ClassifiedCompatibilityResult,
    format: 'text' | 'json' | 'markdown' = 'text',
  ): string {
    switch (format) {
      case 'json':
        return JSON.stringify(classified, null, 2);
      case 'markdown':
        return this.formatAsMarkdown(classified);
      case 'text':
      default:
        return this.formatAsText(classified);
    }
  }

  private formatAsText(r: ClassifiedCompatibilityResult): string {
    const lines: string[] = [];
    const emoji = r.isCompatible ? '✅' : '❌';

    lines.push('╔══════════════════════════════════════════════════════════════╗');
    lines.push('║           API 兼容性检查报告                                  ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');
    lines.push('');
    lines.push(`${emoji} 总体结果: ${r.isCompatible ? '兼容' : '不兼容'}`);
    lines.push(`   严重级别: ${r.severityLevel.toUpperCase()}`);
    lines.push(`   CI 退出码: ${r.exitCode}`);
    lines.push('');
    lines.push('📊 变更统计:');
    lines.push(`   破坏性变更: ${r.summary.totalBreaking}`);
    lines.push(`     ├─ 请求侧: ${r.summary.requestSideBreakingCount}`);
    lines.push(`     ├─ 响应侧: ${r.summary.responseSideBreakingCount}`);
    lines.push(`     └─ 位置不明: ${r.summary.totalBreaking - r.summary.requestSideBreakingCount - r.summary.responseSideBreakingCount}`);
    lines.push(`   非破坏性变更: ${r.summary.totalNonBreaking}`);
    lines.push(`     ├─ 新增字段/参数: ${r.summary.addedFieldsCount}`);
    lines.push(`     └─ 其他: ${r.summary.totalNonBreaking - r.summary.addedFieldsCount}`);

    if (r.classification.requestSideBreaking.length > 0) {
      lines.push('');
      lines.push('🚨 请求侧破坏性变更 (会导致旧客户端出错):');
      for (const c of r.classification.requestSideBreaking) {
        lines.push(`   • [${c.type}] ${c.method?.toUpperCase() || ''} ${c.path}`);
        lines.push(`     ${c.message}`);
      }
    }

    if (r.classification.responseSideBreaking.length > 0) {
      lines.push('');
      lines.push('⚠️ 响应侧破坏性变更 (可能影响客户端解析):');
      for (const c of r.classification.responseSideBreaking) {
        lines.push(`   • [${c.type}] ${c.method?.toUpperCase() || ''} ${c.path}`);
        lines.push(`     ${c.message}`);
      }
    }

    if (r.classification.addedFields.length > 0) {
      lines.push('');
      lines.push('➕ 新增字段/参数 (非破坏性):');
      for (const c of r.classification.addedFields) {
        lines.push(`   • [${c.type}] ${c.method?.toUpperCase() || ''} ${c.path}`);
        lines.push(`     ${c.message}`);
      }
    }

    lines.push('');
    lines.push('💡 建议:');
    for (const rec of r.recommendations) {
      lines.push(`   ${rec}`);
    }

    return lines.join('\n');
  }

  private formatAsMarkdown(r: ClassifiedCompatibilityResult): string {
    const lines: string[] = [];
    const badge = r.isCompatible
      ? '![Compatible](https://img.shields.io/badge/兼容-✅-green)'
      : '![Breaking](https://img.shields.io/badge/不兼容-❌-red)';

    lines.push('# API 兼容性检查报告');
    lines.push('');
    lines.push(`${badge} **总体结果: ${r.isCompatible ? '兼容' : '不兼容'}**`);
    lines.push('');
    lines.push(`- **严重级别**: \`${r.severityLevel.toUpperCase()}\``);
    lines.push(`- **CI 退出码**: \`${r.exitCode}\``);
    lines.push('');

    lines.push('## 📊 变更统计');
    lines.push('');
    lines.push('| 类别 | 数量 |');
    lines.push('|------|------|');
    lines.push(`| 破坏性变更 | **${r.summary.totalBreaking}** |`);
    lines.push(`| &nbsp;&nbsp;请求侧破坏 | ${r.summary.requestSideBreakingCount} |`);
    lines.push(`| &nbsp;&nbsp;响应侧破坏 | ${r.summary.responseSideBreakingCount} |`);
    lines.push(`| 非破坏性变更 | ${r.summary.totalNonBreaking} |`);
    lines.push(`| &nbsp;&nbsp;新增字段/参数 | ${r.summary.addedFieldsCount} |`);
    lines.push('');

    if (r.classification.requestSideBreaking.length > 0) {
      lines.push('## 🚨 请求侧破坏性变更');
      lines.push('');
      lines.push('> ❌ 这些变更会导致旧客户端调用失败，必须同步升级');
      lines.push('');
      for (const c of r.classification.requestSideBreaking) {
        lines.push(`### [${c.type}] ${c.method?.toUpperCase() || ''} \`${c.path}\``);
        lines.push('');
        lines.push(c.message);
        lines.push('');
      }
    }

    if (r.classification.responseSideBreaking.length > 0) {
      lines.push('## ⚠️ 响应侧破坏性变更');
      lines.push('');
      lines.push('> 这些变更可能影响使用这些字段的客户端');
      lines.push('');
      for (const c of r.classification.responseSideBreaking) {
        lines.push(`### [${c.type}] ${c.method?.toUpperCase() || ''} \`${c.path}\``);
        lines.push('');
        lines.push(c.message);
        lines.push('');
      }
    }

    if (r.classification.addedFields.length > 0) {
      lines.push('## ➕ 新增字段/参数（非破坏性）');
      lines.push('');
      for (const c of r.classification.addedFields) {
        lines.push(`- [${c.type}] ${c.method?.toUpperCase() || ''} \`${c.path}\` - ${c.message}`);
      }
      lines.push('');
    }

    lines.push('## 💡 建议');
    lines.push('');
    for (const rec of r.recommendations) {
      lines.push(`- ${rec}`);
    }

    return lines.join('\n');
  }

  checkWithCI(oldSpec: ApiModel, newSpec: ApiModel): ClassifiedCompatibilityResult {
    const result = this.check(oldSpec, newSpec);
    return this.classifyChanges(result);
  }
}

export interface ClassifiedCompatibilityResult extends CompatibilityResult {
  classification: {
    requestSideBreaking: BreakingChange[];
    responseSideBreaking: BreakingChange[];
    unclearBreaking: BreakingChange[];
    addedFields: NonBreakingChange[];
    otherNonBreaking: NonBreakingChange[];
  };
  summary: {
    totalBreaking: number;
    totalNonBreaking: number;
    requestSideBreakingCount: number;
    responseSideBreakingCount: number;
    addedFieldsCount: number;
  };
  severityLevel: 'safe' | 'warn' | 'danger';
  exitCode: number;
  recommendations: string[];
}

export function checkCompatibility(oldSpec: ApiModel, newSpec: ApiModel): CompatibilityResult {
  const checker = new CompatibilityChecker();
  return checker.check(oldSpec, newSpec);
}

export function checkCompatibilityWithCI(
  oldSpec: ApiModel,
  newSpec: ApiModel,
): ClassifiedCompatibilityResult {
  const checker = new CompatibilityChecker();
  return checker.checkWithCI(oldSpec, newSpec);
}

export function formatCompatibilityReport(
  result: CompatibilityResult | ClassifiedCompatibilityResult,
  format: 'text' | 'json' | 'markdown' = 'text',
): string {
  const checker = new CompatibilityChecker();
  const classified =
    'classification' in (result as any)
      ? (result as ClassifiedCompatibilityResult)
      : checker.classifyChanges(result);
  return checker.formatResult(classified, format);
}

export function getCompatibilityExitCode(result: CompatibilityResult | ClassifiedCompatibilityResult): number {
  const checker = new CompatibilityChecker();
  const classified =
    'classification' in (result as any)
      ? (result as ClassifiedCompatibilityResult)
      : checker.classifyChanges(result);
  return classified.exitCode;
}

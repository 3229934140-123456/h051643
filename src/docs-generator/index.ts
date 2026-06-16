import { ApiModel, Endpoint, SchemaObject, ParameterObject, HttpMethod } from '../types';
import { SchemaDataGenerator } from '../mock-engine/schema-generator';

const methodColors: Record<HttpMethod, string> = {
  get: '#61affe',
  post: '#49cc90',
  put: '#fca130',
  delete: '#f93e3e',
  patch: '#50e3c2',
  options: '#0d5aa7',
  head: '#9012fe',
};

export class DocsGenerator {
  private apiModel: ApiModel;
  private dataGenerator: SchemaDataGenerator;

  constructor(apiModel: ApiModel) {
    this.apiModel = apiModel;
    this.dataGenerator = new SchemaDataGenerator(42);
  }

  generateHTML(): string {
    const endpointsByTag = this.groupEndpointsByTag();
    const tags = this.apiModel.tags.length > 0 ? this.apiModel.tags : this.getAutoTags();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(this.apiModel.info.title)}</title>
  <style>
    ${this.getStyles()}
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>${this.escapeHtml(this.apiModel.info.title)}</h1>
      <p class="version">Version: ${this.escapeHtml(this.apiModel.info.version)}</p>
      ${this.apiModel.info.description ? `<p class="description">${this.escapeHtml(this.apiModel.info.description)}</p>` : ''}
    </header>

    <nav class="sidebar">
      <h3>API 目录</h3>
      <ul class="tag-list">
        ${tags
          .map(
            (tag) => `
          <li>
            <div class="tag-header" onclick="toggleTag('${this.escapeHtml(tag.name)}')">
              <span class="tag-arrow">▼</span>
              <span>${this.escapeHtml(tag.name)}</span>
            </div>
            <ul class="endpoint-list" id="list-${this.escapeHtml(tag.name)}">
              ${(endpointsByTag[tag.name] || [])
                .map(
                  (ep) => `
                <li class="endpoint-item" onclick="scrollToEndpoint('${this.getEndpointId(ep)}')">
                  <span class="method-badge method-${ep.method}">${ep.method.toUpperCase()}</span>
                  <span class="endpoint-path">${this.escapeHtml(ep.path)}</span>
                </li>
              `,
                )
                .join('')}
            </ul>
          </li>
        `,
          )
          .join('')}
      </ul>
    </nav>

    <main class="content">
      ${tags
        .map(
          (tag) => `
        <section class="tag-section" id="tag-${this.escapeHtml(tag.name)}">
          <h2>${this.escapeHtml(tag.name)}</h2>
          ${tag.description ? `<p class="tag-description">${this.escapeHtml(tag.description)}</p>` : ''}
          ${(endpointsByTag[tag.name] || [])
            .map((ep) => this.renderEndpoint(ep))
            .join('')}
        </section>
      `,
        )
        .join('')}

      ${Object.keys(this.apiModel.schemas).length > 0 ? `
      <section class="schemas-section">
        <h2>数据模型</h2>
        ${Object.entries(this.apiModel.schemas)
          .map(([name, schema]) => this.renderSchema(name, schema))
          .join('')}
      </section>
      ` : ''}
    </main>
  </div>

  <script>
    ${this.getJavaScript()}
  </script>
</body>
</html>`;
  }

  private groupEndpointsByTag(): Record<string, Endpoint[]> {
    const groups: Record<string, Endpoint[]> = {};

    for (const ep of this.apiModel.endpoints) {
      if (ep.tags.length > 0) {
        for (const tag of ep.tags) {
          if (!groups[tag]) groups[tag] = [];
          groups[tag].push(ep);
        }
      } else {
        if (!groups['default']) groups['default'] = [];
        groups['default'].push(ep);
      }
    }

    return groups;
  }

  private getAutoTags(): { name: string; description?: string }[] {
    const tagSet = new Set<string>();
    for (const ep of this.apiModel.endpoints) {
      if (ep.tags.length > 0) {
        ep.tags.forEach((t) => tagSet.add(t));
      } else {
        tagSet.add('default');
      }
    }
    return Array.from(tagSet).map((name) => ({ name }));
  }

  private renderEndpoint(endpoint: Endpoint): string {
    const id = this.getEndpointId(endpoint);
    const requestExample = this.generateRequestExample(endpoint);
    const responseExamples = this.generateResponseExamples(endpoint);

    return `
      <div class="endpoint-card" id="${id}">
        <div class="endpoint-header">
          <span class="method-badge method-${endpoint.method}">${endpoint.method.toUpperCase()}</span>
          <span class="endpoint-path">${this.escapeHtml(endpoint.path)}</span>
          <button class="expand-btn" onclick="toggleEndpoint('${id}')">展开</button>
        </div>
        ${endpoint.summary ? `<div class="endpoint-summary">${this.escapeHtml(endpoint.summary)}</div>` : ''}

        <div class="endpoint-details" id="details-${id}" style="display:none;">
          ${endpoint.description ? `<p class="endpoint-description">${this.escapeHtml(endpoint.description)}</p>` : ''}

          ${endpoint.parameters.length > 0 ? `
          <div class="parameters-section">
            <h4>参数</h4>
            ${this.renderParameters(endpoint.parameters)}
          </div>
          ` : ''}

          ${endpoint.requestBody ? `
          <div class="request-body-section">
            <h4>请求体 ${endpoint.requestBody.required ? '<span class="required-badge">必填</span>' : ''}</h4>
            ${this.renderRequestBody(endpoint)}
          </div>
          ` : ''}

          <div class="responses-section">
            <h4>响应</h4>
            ${this.renderResponses(endpoint, responseExamples)}
          </div>

          <div class="try-section">
            <h4>请求示例</h4>
            ${this.renderRequestExample(endpoint, requestExample)}
          </div>
        </div>
      </div>
    `;
  }

  private getEndpointId(endpoint: Endpoint): string {
    return `ep-${endpoint.method}-${endpoint.path.replace(/[{}]/g, '').replace(/\//g, '-')}`;
  }

  private renderParameters(parameters: ParameterObject[]): string {
    const grouped: Record<string, ParameterObject[]> = {};

    for (const p of parameters) {
      if (!grouped[p.in]) grouped[p.in] = [];
      grouped[p.in].push(p);
    }

    return Object.entries(grouped)
      .map(
        ([inType, params]) => `
      <div class="param-group">
        <h5>${this.getParamInLabel(inType)}</h5>
        <table class="param-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>必填</th>
              <th>描述</th>
            </tr>
          </thead>
          <tbody>
            ${params
              .map(
                (p) => `
              <tr>
                <td class="param-name">${this.escapeHtml(p.name)}</td>
                <td class="param-type">${p.schema ? this.getSchemaTypeLabel(p.schema) : '-'}</td>
                <td>${p.required ? '<span class="required-badge">是</span>' : '否'}</td>
                <td>${p.description ? this.escapeHtml(p.description) : '-'}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `,
      )
      .join('');
  }

  private getParamInLabel(inType: string): string {
    const labels: Record<string, string> = {
      query: 'Query 参数',
      path: '路径参数',
      header: '请求头',
      cookie: 'Cookie',
    };
    return labels[inType] || inType;
  }

  private getSchemaTypeLabel(schema: SchemaObject): string {
    if ('type' in schema && schema.type) {
      let label = schema.type as string;
      if ((schema as any).format) {
        label += ` (${(schema as any).format})`;
      }
      if (schema.type === 'array' && (schema as any).items) {
        const itemType = this.getSchemaTypeLabel((schema as any).items);
        label = `${itemType}[]`;
      }
      return label;
    }
    if ('allOf' in schema) return 'object (allOf)';
    if ('anyOf' in schema) return 'object (anyOf)';
    if ('oneOf' in schema) return 'object (oneOf)';
    return 'object';
  }

  private renderRequestBody(endpoint: Endpoint): string {
    if (!endpoint.requestBody?.content) return '';

    const contentTypes = Object.keys(endpoint.requestBody.content);
    const jsonContent = endpoint.requestBody.content['application/json'];

    if (!jsonContent?.schema) {
      return `<p>支持的 Content-Type: ${contentTypes.join(', ')}</p>`;
    }

    return `
      <p>Content-Type: application/json</p>
      <div class="schema-preview">
        ${this.renderSchemaTree(jsonContent.schema)}
      </div>
    `;
  }

  private renderResponses(endpoint: Endpoint, examples: Record<string, any>): string {
    return Object.entries(endpoint.responses)
      .map(
        ([statusCode, response]) => `
      <div class="response-item">
        <div class="response-header" onclick="toggleResponse('${endpoint.path}-${statusCode}')">
          <span class="status-code status-${this.getStatusClass(statusCode)}">${statusCode}</span>
          <span class="response-desc">${this.escapeHtml(response.description)}</span>
          <span class="toggle-arrow">▼</span>
        </div>
        <div class="response-content" id="resp-${endpoint.path}-${statusCode}" style="display:none;">
          ${
            response.content?.['application/json']?.schema
              ? `<div class="schema-preview">
                   ${this.renderSchemaTree(response.content['application/json'].schema)}
                 </div>`
              : ''
          }
          ${
            examples[statusCode] !== undefined
              ? `<div class="example-box">
                   <h6>响应示例</h6>
                   <pre class="code-block">${this.escapeHtml(JSON.stringify(examples[statusCode], null, 2))}</pre>
                 </div>`
              : ''
          }
        </div>
      </div>
    `,
      )
      .join('');
  }

  private getStatusClass(statusCode: string): string {
    if (statusCode.startsWith('2')) return 'success';
    if (statusCode.startsWith('4')) return 'error';
    if (statusCode.startsWith('5')) return 'error';
    if (statusCode.startsWith('3')) return 'redirect';
    return 'default';
  }

  private renderSchemaTree(schema: SchemaObject, depth: number = 0): string {
    if ('allOf' in schema && schema.allOf) {
      return `<div class="schema-allof">
        <span class="schema-keyword">allOf:</span>
        ${schema.allOf.map((s) => this.renderSchemaTree(s, depth + 1)).join('')}
      </div>`;
    }

    if ('anyOf' in schema && schema.anyOf) {
      return `<div class="schema-anyof">
        <span class="schema-keyword">anyOf:</span>
        ${schema.anyOf.map((s) => this.renderSchemaTree(s, depth + 1)).join('')}
      </div>`;
    }

    if ('oneOf' in schema && schema.oneOf) {
      return `<div class="schema-oneof">
        <span class="schema-keyword">oneOf:</span>
        ${schema.oneOf.map((s) => this.renderSchemaTree(s, depth + 1)).join('')}
      </div>`;
    }

    const type = 'type' in schema ? schema.type : 'object';

    if (type === 'object' && (schema as any).properties) {
      const objSchema = schema as any;
      const required = new Set(objSchema.required || []);

      return `<div class="schema-object">
        <span class="schema-type">{object}</span>
        <div class="schema-properties">
          ${Object.entries(objSchema.properties || {})
            .map(
              ([propName, propSchema]: [string, any]) => `
            <div class="schema-property">
              <span class="prop-name ${required.has(propName) ? 'required' : ''}">${this.escapeHtml(propName)}</span>
              <span class="prop-type">${this.getSchemaTypeLabel(propSchema)}</span>
              ${propSchema.description ? `<span class="prop-desc">${this.escapeHtml(propSchema.description)}</span>` : ''}
              ${propSchema.type === 'object' || propSchema.type === 'array' ? this.renderSchemaTree(propSchema, depth + 1) : ''}
            </div>
          `,
            )
            .join('')}
        </div>
      </div>`;
    }

    if (type === 'array' && (schema as any).items) {
      return `<div class="schema-array">
        <span class="schema-type">array</span>
        <div class="schema-items">
          ${this.renderSchemaTree((schema as any).items, depth + 1)}
        </div>
      </div>`;
    }

    return `<span class="schema-type">${type}</span>`;
  }

  private renderSchema(name: string, schema: SchemaObject): string {
    return `
      <div class="schema-card" id="schema-${this.escapeHtml(name)}">
        <h3 class="schema-name">${this.escapeHtml(name)}</h3>
        <div class="schema-content">
          ${this.renderSchemaTree(schema)}
        </div>
      </div>
    `;
  }

  private generateRequestExample(endpoint: Endpoint): any {
    if (!endpoint.requestBody?.content?.['application/json']?.schema) {
      return null;
    }
    return this.dataGenerator.generate(endpoint.requestBody.content['application/json'].schema);
  }

  private generateResponseExamples(endpoint: Endpoint): Record<string, any> {
    const examples: Record<string, any> = {};

    for (const [statusCode, response] of Object.entries(endpoint.responses)) {
      const schema = response.content?.['application/json']?.schema;
      if (schema) {
        examples[statusCode] = this.dataGenerator.generate(schema);
      }
    }

    return examples;
  }

  private renderRequestExample(endpoint: Endpoint, example: any): string {
    const curlExample = this.generateCurlExample(endpoint, example);

    return `
      <div class="example-tabs">
        <button class="tab-btn active" onclick="switchTab(this, '${this.getEndpointId(endpoint)}-json')">JSON</button>
        <button class="tab-btn" onclick="switchTab(this, '${this.getEndpointId(endpoint)}-curl')">cURL</button>
      </div>
      <div class="tab-content active" id="${this.getEndpointId(endpoint)}-json">
        <pre class="code-block">${this.escapeHtml(example ? JSON.stringify(example, null, 2) : '// 无请求体')}</pre>
      </div>
      <div class="tab-content" id="${this.getEndpointId(endpoint)}-curl" style="display:none;">
        <pre class="code-block">${this.escapeHtml(curlExample)}</pre>
      </div>
    `;
  }

  private generateCurlExample(endpoint: Endpoint, body: any): string {
    const baseUrl = this.apiModel.servers?.[0]?.url || 'https://api.example.com';
    let path = endpoint.path;

    const pathParams = endpoint.parameters.filter((p) => p.in === 'path');
    for (const p of pathParams) {
      const exampleValue = p.example || `{${p.name}}`;
      path = path.replace(`{${p.name}}`, String(exampleValue));
    }

    let curl = `curl -X ${endpoint.method.toUpperCase()} '${baseUrl}${path}'`;

    const queryParams = endpoint.parameters.filter((p) => p.in === 'query');
    if (queryParams.length > 0) {
      curl += ' \\\n  -G';
      for (const p of queryParams) {
        const value = p.example || 'value';
        curl += ` \\\n  --data-urlencode '${p.name}=${value}'`;
      }
    }

    const headerParams = endpoint.parameters.filter((p) => p.in === 'header');
    for (const p of headerParams) {
      const value = p.example || 'value';
      curl += ` \\\n  -H '${p.name}: ${value}'`;
    }

    if (body && endpoint.requestBody) {
      curl += ` \\\n  -H 'Content-Type: application/json'`;
      curl += ` \\\n  -d '${JSON.stringify(body)}'`;
    }

    return curl;
  }

  private getStyles(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #f5f7fa;
        color: #333;
        line-height: 1.6;
      }
      .container {
        display: grid;
        grid-template-columns: 280px 1fr;
        grid-template-rows: auto 1fr;
        min-height: 100vh;
      }
      .header {
        grid-column: 1 / -1;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 30px 40px;
      }
      .header h1 { font-size: 28px; margin-bottom: 8px; }
      .header .version { opacity: 0.9; font-size: 14px; }
      .header .description { margin-top: 10px; opacity: 0.85; }

      .sidebar {
        background: #fff;
        border-right: 1px solid #e0e0e0;
        padding: 20px 0;
        position: sticky;
        top: 0;
        height: 100vh;
        overflow-y: auto;
      }
      .sidebar h3 { padding: 0 20px 15px; color: #555; font-size: 14px; text-transform: uppercase; }
      .tag-list { list-style: none; }
      .tag-header {
        padding: 10px 20px;
        cursor: pointer;
        font-weight: 600;
        color: #333;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .tag-header:hover { background: #f0f2f5; }
      .tag-arrow { font-size: 10px; transition: transform 0.2s; }
      .endpoint-list { list-style: none; }
      .endpoint-item {
        padding: 8px 20px 8px 40px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
      }
      .endpoint-item:hover { background: #f0f2f5; }

      .content {
        padding: 30px;
        max-width: 900px;
      }
      .tag-section { margin-bottom: 40px; }
      .tag-section h2 {
        margin-bottom: 20px;
        color: #2c3e50;
        border-bottom: 2px solid #667eea;
        padding-bottom: 8px;
      }
      .tag-description { color: #666; margin-bottom: 20px; }

      .endpoint-card {
        background: #fff;
        border-radius: 8px;
        margin-bottom: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        overflow: hidden;
      }
      .endpoint-header {
        padding: 16px 20px;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
      }
      .method-badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 4px;
        color: white;
        font-weight: 700;
        font-size: 12px;
        text-transform: uppercase;
        min-width: 65px;
        text-align: center;
      }
      .method-get { background: #61affe; }
      .method-post { background: #49cc90; }
      .method-put { background: #fca130; }
      .method-delete { background: #f93e3e; }
      .method-patch { background: #50e3c2; }

      .endpoint-path { font-family: 'Monaco', 'Consolas', monospace; font-size: 14px; flex: 1; }
      .expand-btn {
        padding: 6px 16px;
        border: 1px solid #ddd;
        background: #fff;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      .expand-btn:hover { background: #f5f5f5; }

      .endpoint-summary { padding: 0 20px 12px; color: #666; font-size: 14px; }
      .endpoint-details { padding: 0 20px 20px; }
      .endpoint-description { margin-bottom: 20px; color: #555; }

      .parameters-section, .request-body-section, .responses-section, .try-section {
        margin-bottom: 20px;
      }
      .parameters-section h4, .request-body-section h4, .responses-section h4, .try-section h4 {
        margin-bottom: 12px;
        color: #333;
        font-size: 15px;
      }

      .param-group { margin-bottom: 16px; }
      .param-group h5 { color: #666; font-size: 13px; margin-bottom: 8px; }
      .param-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .param-table th, .param-table td {
        text-align: left;
        padding: 8px 12px;
        border-bottom: 1px solid #eee;
      }
      .param-table th { background: #f8f9fa; font-weight: 600; }
      .param-name { font-family: monospace; font-weight: 500; }
      .param-type { color: #667eea; font-family: monospace; }

      .required-badge {
        display: inline-block;
        padding: 2px 6px;
        background: #ffebee;
        color: #c62828;
        border-radius: 3px;
        font-size: 11px;
        font-weight: 600;
      }

      .response-item { margin-bottom: 10px; border: 1px solid #eee; border-radius: 6px; }
      .response-header {
        padding: 10px 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        background: #fafafa;
      }
      .status-code {
        font-weight: 700;
        font-family: monospace;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 13px;
      }
      .status-success { background: #e8f5e9; color: #2e7d32; }
      .status-error { background: #ffebee; color: #c62828; }
      .status-redirect { background: #fff3e0; color: #e65100; }
      .status-default { background: #f5f5f5; color: #666; }
      .response-desc { flex: 1; font-size: 13px; color: #555; }
      .toggle-arrow { font-size: 10px; color: #999; }
      .response-content { padding: 14px; }

      .schema-preview {
        background: #f8f9fa;
        border-radius: 6px;
        padding: 12px;
        font-size: 13px;
        font-family: 'Monaco', 'Consolas', monospace;
      }
      .schema-type { color: #667eea; font-weight: 500; }
      .schema-keyword { color: #e91e63; font-weight: 500; }
      .schema-property { margin-left: 20px; padding: 4px 0; }
      .prop-name { color: #2c3e50; font-weight: 500; }
      .prop-name.required::after { content: ' *'; color: #f44336; }
      .prop-type { color: #667eea; margin-left: 10px; font-size: 12px; }
      .prop-desc { color: #888; margin-left: 10px; font-size: 12px; }
      .schema-properties { margin-left: 20px; }
      .schema-items { margin-left: 20px; }

      .example-box { margin-top: 12px; }
      .example-box h6 { margin-bottom: 8px; color: #555; font-size: 12px; text-transform: uppercase; }
      .code-block {
        background: #1e293b;
        color: #e2e8f0;
        padding: 16px;
        border-radius: 6px;
        overflow-x: auto;
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 12px;
        line-height: 1.5;
      }

      .example-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
      .tab-btn {
        padding: 6px 14px;
        border: 1px solid #ddd;
        background: #f5f5f5;
        border-radius: 4px 4px 0 0;
        cursor: pointer;
        font-size: 12px;
      }
      .tab-btn.active {
        background: #fff;
        border-bottom-color: #fff;
        font-weight: 600;
      }
      .tab-content { background: #fff; }

      .schemas-section { margin-top: 40px; }
      .schemas-section h2 {
        margin-bottom: 20px;
        color: #2c3e50;
        border-bottom: 2px solid #667eea;
        padding-bottom: 8px;
      }
      .schema-card {
        background: #fff;
        border-radius: 8px;
        margin-bottom: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        padding: 20px;
      }
      .schema-name { color: #333; font-size: 16px; margin-bottom: 12px; }

      @media (max-width: 768px) {
        .container { grid-template-columns: 1fr; }
        .sidebar { display: none; }
        .content { padding: 20px; }
      }
    `;
  }

  private getJavaScript(): string {
    return `
      function toggleTag(tagName) {
        const list = document.getElementById('list-' + tagName);
        const header = list?.previousElementSibling;
        const arrow = header?.querySelector('.tag-arrow');
        if (list) {
          if (list.style.display === 'none') {
            list.style.display = 'block';
            if (arrow) arrow.style.transform = 'rotate(0deg)';
          } else {
            list.style.display = 'none';
            if (arrow) arrow.style.transform = 'rotate(-90deg)';
          }
        }
      }

      function toggleEndpoint(id) {
        const details = document.getElementById('details-' + id);
        const btn = document.querySelector('#' + id + ' .expand-btn');
        if (details) {
          if (details.style.display === 'none') {
            details.style.display = 'block';
            if (btn) btn.textContent = '收起';
          } else {
            details.style.display = 'none';
            if (btn) btn.textContent = '展开';
          }
        }
      }

      function toggleResponse(key) {
        const content = document.getElementById('resp-' + key);
        if (content) {
          content.style.display = content.style.display === 'none' ? 'block' : 'none';
        }
      }

      function scrollToEndpoint(id) {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const details = document.getElementById('details-' + id);
          if (details) {
            details.style.display = 'block';
            const btn = document.querySelector('#' + id + ' .expand-btn');
            if (btn) btn.textContent = '收起';
          }
        }
      }

      function switchTab(btn, targetId) {
        const tabs = btn.parentElement.querySelectorAll('.tab-btn');
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');

        const parent = btn.closest('.try-section');
        const contents = parent.querySelectorAll('.tab-content');
        contents.forEach(c => c.style.display = 'none');

        const target = document.getElementById(targetId);
        if (target) target.style.display = 'block';
      }
    `;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export function generateDocs(apiModel: ApiModel): string {
  const generator = new DocsGenerator(apiModel);
  return generator.generateHTML();
}

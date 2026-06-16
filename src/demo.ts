import * as fs from 'fs';
import * as path from 'path';
import {
  OpenAPIParser,
  MockEngine,
  ContractValidator,
  CompatibilityChecker,
  DocsGenerator,
  SchemaDataGenerator,
} from './index';
import { sampleSpecV1, sampleSpecV2, breakingChangeSpec } from './samples/sample-spec';
import { HttpMethod, MockRequest, MockResponse } from './types';

function section(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function subsection(title: string) {
  console.log(`\n--- ${title} ---`);
}

function demo() {
  console.log('\n' + '╔'.repeat(60));
  console.log('  API 文档与契约测试平台 - 核心模块演示');
  console.log('╚'.repeat(60));

  section('1. OpenAPI 解析模块');

  const parser = new OpenAPIParser(sampleSpecV1);
  const apiModel = parser.parse();

  console.log(`\nAPI 标题: ${apiModel.info.title}`);
  console.log(`版本: ${apiModel.info.version}`);
  console.log(`服务器数量: ${apiModel.servers.length}`);
  console.log(`标签数量: ${apiModel.tags.length}`);
  console.log(`端点总数: ${apiModel.endpoints.length}`);
  console.log(`Schema 数量: ${Object.keys(apiModel.schemas).length}`);

  subsection('端点列表');
  for (const ep of apiModel.endpoints) {
    console.log(`  ${ep.method.toUpperCase().padEnd(7)} ${ep.path}`);
    console.log(`    - 摘要: ${ep.summary || '无'}`);
    console.log(`    - 参数: ${ep.parameters.length} 个`);
    console.log(`    - 响应: ${Object.keys(ep.responses).length} 个状态码`);
  }

  subsection('Schema 列表');
  for (const [name] of Object.entries(apiModel.schemas)) {
    console.log(`  - ${name}`);
  }

  section('2. Mock 引擎 - 数据生成');

  const dataGenerator = new SchemaDataGenerator(42);

  subsection('根据 User Schema 生成模拟数据');
  const userSchema = apiModel.schemas['User'];
  const mockUser = dataGenerator.generate(userSchema);
  console.log(JSON.stringify(mockUser, null, 2));

  subsection('根据 Order Schema 生成模拟数据');
  const orderSchema = apiModel.schemas['Order'];
  const mockOrder = dataGenerator.generate(orderSchema);
  console.log(JSON.stringify(mockOrder, null, 2));

  section('3. Mock 引擎 - HTTP Mock 服务');

  const mockEngine = new MockEngine(apiModel, parser, 42);

  subsection('GET /users - 获取用户列表');
  const getUsersRequest: MockRequest = {
    path: '/users',
    method: 'get' as HttpMethod,
    query: { page: 1, pageSize: 5 },
  };
  const getUsersResponse = mockEngine.handleRequest(getUsersRequest);
  console.log(`状态码: ${getUsersResponse.status}`);
  console.log(`用户数量: ${getUsersResponse.body.data?.length || 0}`);
  console.log(`总数: ${getUsersResponse.body.total}`);

  subsection('POST /users - 创建用户');
  const createUserRequest: MockRequest = {
    path: '/users',
    method: 'post' as HttpMethod,
    body: {
      name: '张三',
      email: 'zhangsan@example.com',
      status: 'active',
      profile: {
        age: 28,
        phone: '13800138000',
      },
    },
  };
  const createUserResponse = mockEngine.handleRequest(createUserRequest);
  console.log(`状态码: ${createUserResponse.status}`);
  console.log(`用户ID: ${createUserResponse.body.id}`);
  console.log(`用户名: ${createUserResponse.body.name}`);
  console.log(`创建时间: ${createUserResponse.body.createdAt}`);

  subsection('GET /users/{id} - 查询创建的用户 (有状态 Mock)');
  const userId = createUserResponse.body.id;
  const getUserRequest: MockRequest = {
    path: `/users/${userId}`,
    method: 'get' as HttpMethod,
  };
  const getUserResponse = mockEngine.handleRequest(getUserRequest);
  console.log(`状态码: ${getUserResponse.status}`);
  console.log(`用户ID: ${getUserResponse.body.id}`);
  console.log(`用户名: ${getUserResponse.body.name}`);
  console.log(`邮箱: ${getUserResponse.body.email}`);

  subsection('PUT /users/{id} - 更新用户');
  const updateUserRequest: MockRequest = {
    path: `/users/${userId}`,
    method: 'put' as HttpMethod,
    body: {
      name: '张三丰',
      status: 'inactive',
    },
  };
  const updateUserResponse = mockEngine.handleRequest(updateUserRequest);
  console.log(`状态码: ${updateUserResponse.status}`);
  console.log(`更新后用户名: ${updateUserResponse.body.name}`);
  console.log(`更新后状态: ${updateUserResponse.body.status}`);

  subsection('验证更新后的数据');
  const getUpdatedUserResponse = mockEngine.handleRequest(getUserRequest);
  console.log(`当前用户名: ${getUpdatedUserResponse.body.name}`);
  console.log(`当前状态: ${getUpdatedUserResponse.body.status}`);

  subsection('DELETE /users/{id} - 删除用户');
  const deleteUserRequest: MockRequest = {
    path: `/users/${userId}`,
    method: 'delete' as HttpMethod,
  };
  const deleteUserResponse = mockEngine.handleRequest(deleteUserRequest);
  console.log(`状态码: ${deleteUserResponse.status}`);
  console.log(`删除成功: ${deleteUserResponse.body.success}`);
  console.log(`删除ID: ${deleteUserResponse.body.id}`);

  subsection('验证删除后的数据');
  const getDeletedUserResponse = mockEngine.handleRequest(getUserRequest);
  console.log(`状态码: ${getDeletedUserResponse.status}`);
  console.log(`错误: ${getDeletedUserResponse.body.error}`);

  section('4. 契约校验模块');

  const contractValidator = new ContractValidator(apiModel, parser);

  subsection('有效响应 - 校验通过');
  const validResponse: MockResponse = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      data: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: '测试用户',
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
  const validResult = contractValidator.validateEndpoint('/users', 'get', getUsersRequest, validResponse);
  console.log(`校验通过: ${validResult.valid}`);
  console.log(`请求错误: ${validResult.requestErrors.length} 个`);
  console.log(`响应错误: ${validResult.responseErrors.length} 个`);

  subsection('无效响应 - 类型错误');
  const invalidTypeResponse: MockResponse = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      data: '不是数组',
      total: '不是数字',
      page: 1,
      pageSize: 10,
    },
  };
  const invalidTypeResult = contractValidator.validateEndpoint(
    '/users',
    'get',
    getUsersRequest,
    invalidTypeResponse,
  );
  console.log(`校验通过: ${invalidTypeResult.valid}`);
  console.log(`错误数量: ${invalidTypeResult.responseErrors.length}`);
  console.log('错误详情:');
  for (const err of invalidTypeResult.responseErrors) {
    console.log(`  - ${err.path}: ${err.message}`);
  }

  subsection('无效响应 - 缺少必填字段');
  const missingFieldResponse: MockResponse = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      data: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: '测试用户',
        },
      ],
      total: 1,
    },
  };
  const missingFieldResult = contractValidator.validateEndpoint(
    '/users',
    'get',
    getUsersRequest,
    missingFieldResponse,
  );
  console.log(`校验通过: ${missingFieldResult.valid}`);
  console.log(`错误数量: ${missingFieldResult.responseErrors.length}`);
  console.log('错误详情:');
  for (const err of missingFieldResult.responseErrors) {
    console.log(`  - ${err.path}: ${err.message}`);
  }

  subsection('请求体验证');
  const invalidRequestBody: MockRequest = {
    path: '/users',
    method: 'post' as HttpMethod,
    body: {
      name: 'A',
      email: 'invalid-email',
    },
  };
  const requestValidationResult = contractValidator.validateEndpoint(
    '/users',
    'post',
    invalidRequestBody,
    { status: 201, headers: {}, body: {} },
  );
  console.log(`请求校验错误: ${requestValidationResult.requestErrors.length} 个`);
  console.log('错误详情:');
  for (const err of requestValidationResult.requestErrors) {
    console.log(`  - ${err.path}: ${err.message}`);
  }

  section('5. 兼容检查模块');

  const compatibilityChecker = new CompatibilityChecker();

  subsection('v1 -> v2 兼容性检查 (部分破坏性变更)');
  const v1Model = new OpenAPIParser(sampleSpecV1).parse();
  const v2Model = new OpenAPIParser(sampleSpecV2).parse();
  const v1v2Result = compatibilityChecker.check(v1Model, v2Model);

  console.log(`是否兼容: ${v1v2Result.isCompatible}`);
  console.log(`破坏性变更: ${v1v2Result.breakingChanges.length} 个`);
  console.log(`非破坏性变更: ${v1v2Result.nonBreakingChanges.length} 个`);

  console.log('\n破坏性变更列表:');
  for (const change of v1v2Result.breakingChanges) {
    console.log(`  [${change.type}] ${change.method?.toUpperCase() || ''} ${change.path}`);
    console.log(`      ${change.message}`);
  }

  console.log('\n非破坏性变更列表:');
  for (const change of v1v2Result.nonBreakingChanges) {
    console.log(`  [${change.type}] ${change.method?.toUpperCase() || ''} ${change.path}`);
    console.log(`      ${change.message}`);
  }

  subsection('v1 -> v3 兼容性检查 (大量破坏性变更)');
  const v3Model = new OpenAPIParser(breakingChangeSpec).parse();
  const v1v3Result = compatibilityChecker.check(v1Model, v3Model);

  console.log(`是否兼容: ${v1v3Result.isCompatible}`);
  console.log(`破坏性变更: ${v1v3Result.breakingChanges.length} 个`);
  console.log(`非破坏性变更: ${v1v3Result.nonBreakingChanges.length} 个`);

  console.log('\n破坏性变更列表:');
  for (const change of v1v3Result.breakingChanges.slice(0, 10)) {
    console.log(`  [${change.type}] ${change.method?.toUpperCase() || ''} ${change.path}`);
    console.log(`      ${change.message}`);
  }
  if (v1v3Result.breakingChanges.length > 10) {
    console.log(`  ... 还有 ${v1v3Result.breakingChanges.length - 10} 个变更`);
  }

  section('6. 文档生成模块');

  const docsGenerator = new DocsGenerator(apiModel);
  const htmlContent = docsGenerator.generateHTML();

  const outputDir = path.join(__dirname, '..', 'docs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'api-docs.html');
  fs.writeFileSync(outputPath, htmlContent, 'utf-8');

  console.log(`\n文档已生成: ${outputPath}`);
  console.log(`文件大小: ${(htmlContent.length / 1024).toFixed(2)} KB`);
  console.log('包含内容:');
  console.log('  - API 概览信息');
  console.log('  - 按标签分组的端点列表');
  console.log('  - 每个端点的详细信息 (参数、请求体、响应)');
  console.log('  - Schema 数据模型可视化');
  console.log('  - 请求示例 (JSON / cURL)');
  console.log('  - 响应示例');
  console.log('  - 交互式折叠/展开');
  console.log('  - 侧边栏导航');

  section('7. 自动生成请求示例');

  subsection('所有端点的请求示例');
  const allExamples = mockEngine.generateAllExamples();
  for (const [key, examples] of Object.entries(allExamples).slice(0, 4)) {
    console.log(`\n${key}:`);
    if (examples.request) {
      console.log('  请求示例:');
      console.log('    ' + JSON.stringify(examples.request).slice(0, 100) + '...');
    }
    const responseCodes = Object.keys(examples.responses);
    if (responseCodes.length > 0) {
      console.log(`  响应状态码: ${responseCodes.join(', ')}`);
    }
  }
  console.log(`\n... 共 ${Object.keys(allExamples).length} 个端点`);

  console.log('\n' + '╔'.repeat(60));
  console.log('  演示完成！');
  console.log('╚'.repeat(60));
  console.log('\n模块总结:');
  console.log('  ✓ OpenAPI 解析 - 解析规范为接口模型');
  console.log('  ✓ Mock 引擎 - 据 schema 生成符合契约的响应');
  console.log('  ✓ 有状态 Mock - 创建的资源可被后续查询');
  console.log('  ✓ 契约校验 - 比对真实服务响应与 schema');
  console.log('  ✓ 文档生成 - 生成交互式 HTML 文档');
  console.log('  ✓ 兼容检查 - 检测破坏性变更');
  console.log('  ✓ 请求示例 - 按 schema 自动生成');
}

demo();

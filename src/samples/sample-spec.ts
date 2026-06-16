import { OpenAPISpec } from '../types';

export const sampleSpecV1: OpenAPISpec = {
  openapi: '3.0.0',
  info: {
    title: '用户管理 API',
    version: '1.0.0',
    description: '用户管理系统的 RESTful API 接口',
  },
  servers: [
    {
      url: 'https://api.example.com/v1',
      description: '生产环境',
    },
  ],
  tags: [
    {
      name: '用户管理',
      description: '用户的增删改查操作',
    },
    {
      name: '订单管理',
      description: '订单相关操作',
    },
  ],
  paths: {
    '/users': {
      summary: '用户列表',
      description: '用户资源的集合操作',
      get: {
        summary: '获取用户列表',
        description: '分页获取所有用户列表',
        operationId: 'getUsers',
        tags: ['用户管理'],
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: '页码',
            required: false,
            schema: {
              type: 'integer',
              minimum: 1,
              default: 1,
            },
          },
          {
            name: 'pageSize',
            in: 'query',
            description: '每页数量',
            required: false,
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 10,
            },
          },
          {
            name: 'status',
            in: 'query',
            description: '用户状态筛选',
            required: false,
            schema: {
              type: 'string',
              enum: ['active', 'inactive', 'pending'],
            },
          },
        ],
        responses: {
          '200': {
            description: '成功返回用户列表',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        $ref: '#/components/schemas/User',
                      },
                    },
                    total: {
                      type: 'integer',
                      description: '总记录数',
                    },
                    page: {
                      type: 'integer',
                      description: '当前页码',
                    },
                    pageSize: {
                      type: 'integer',
                      description: '每页数量',
                    },
                  },
                  required: ['data', 'total', 'page', 'pageSize'],
                },
              },
            },
          },
          '400': {
            description: '请求参数错误',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      post: {
        summary: '创建用户',
        description: '创建一个新用户',
        operationId: 'createUser',
        tags: ['用户管理'],
        requestBody: {
          description: '用户信息',
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreateUserRequest',
              },
            },
          },
        },
        responses: {
          '201': {
            description: '用户创建成功',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/User',
                },
              },
            },
          },
          '400': {
            description: '请求参数错误',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/users/{userId}': {
      summary: '用户详情',
      description: '单个用户的操作',
      parameters: [
        {
          name: 'userId',
          in: 'path',
          description: '用户ID',
          required: true,
          schema: {
            type: 'string',
            format: 'uuid',
          },
        },
      ],
      get: {
        summary: '获取用户详情',
        description: '根据ID获取用户详细信息',
        operationId: 'getUserById',
        tags: ['用户管理'],
        responses: {
          '200': {
            description: '成功返回用户信息',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/User',
                },
              },
            },
          },
          '404': {
            description: '用户不存在',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      put: {
        summary: '更新用户',
        description: '更新用户信息',
        operationId: 'updateUser',
        tags: ['用户管理'],
        requestBody: {
          description: '更新的用户信息',
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/UpdateUserRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: '用户更新成功',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/User',
                },
              },
            },
          },
          '400': {
            description: '请求参数错误',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          '404': {
            description: '用户不存在',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
      delete: {
        summary: '删除用户',
        description: '删除指定用户',
        operationId: 'deleteUser',
        tags: ['用户管理'],
        responses: {
          '200': {
            description: '用户删除成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {
                      type: 'boolean',
                    },
                    id: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
          '404': {
            description: '用户不存在',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },
    '/users/{userId}/orders': {
      summary: '用户订单',
      description: '获取用户的订单列表',
      parameters: [
        {
          name: 'userId',
          in: 'path',
          description: '用户ID',
          required: true,
          schema: {
            type: 'string',
          },
        },
      ],
      get: {
        summary: '获取用户订单列表',
        description: '获取指定用户的所有订单',
        operationId: 'getUserOrders',
        tags: ['订单管理', '用户管理'],
        responses: {
          '200': {
            description: '成功返回订单列表',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/Order',
                  },
                },
              },
            },
          },
        },
      },
    },
    '/orders': {
      post: {
        summary: '创建订单',
        description: '创建一个新订单',
        operationId: 'createOrder',
        tags: ['订单管理'],
        requestBody: {
          description: '订单信息',
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreateOrderRequest',
              },
            },
          },
        },
        responses: {
          '201': {
            description: '订单创建成功',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Order',
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        description: '用户信息',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: '用户唯一标识',
          },
          name: {
            type: 'string',
            description: '用户名称',
            minLength: 2,
            maxLength: 50,
          },
          email: {
            type: 'string',
            format: 'email',
            description: '邮箱地址',
          },
          status: {
            type: 'string',
            description: '用户状态',
            enum: ['active', 'inactive', 'pending'],
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: '创建时间',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: '更新时间',
          },
          profile: {
            type: 'object',
            description: '用户资料',
            properties: {
              age: {
                type: 'integer',
                minimum: 0,
                maximum: 150,
              },
              phone: {
                type: 'string',
              },
              address: {
                type: 'string',
              },
            },
          },
        },
        required: ['id', 'name', 'email', 'status', 'createdAt', 'updatedAt'],
      },
      CreateUserRequest: {
        type: 'object',
        description: '创建用户请求',
        properties: {
          name: {
            type: 'string',
            minLength: 2,
            maxLength: 50,
          },
          email: {
            type: 'string',
            format: 'email',
          },
          status: {
            type: 'string',
            enum: ['active', 'inactive', 'pending'],
            default: 'pending',
          },
          profile: {
            type: 'object',
            properties: {
              age: {
                type: 'integer',
                minimum: 0,
                maximum: 150,
              },
              phone: {
                type: 'string',
              },
              address: {
                type: 'string',
              },
            },
          },
        },
        required: ['name', 'email'],
      },
      UpdateUserRequest: {
        type: 'object',
        description: '更新用户请求',
        properties: {
          name: {
            type: 'string',
            minLength: 2,
            maxLength: 50,
          },
          email: {
            type: 'string',
            format: 'email',
          },
          status: {
            type: 'string',
            enum: ['active', 'inactive', 'pending'],
          },
          profile: {
            type: 'object',
            properties: {
              age: {
                type: 'integer',
                minimum: 0,
                maximum: 150,
              },
              phone: {
                type: 'string',
              },
              address: {
                type: 'string',
              },
            },
          },
        },
      },
      Order: {
        type: 'object',
        description: '订单信息',
        properties: {
          id: {
            type: 'string',
            description: '订单ID',
          },
          userId: {
            type: 'string',
            description: '用户ID',
          },
          status: {
            type: 'string',
            enum: ['pending', 'paid', 'shipped', 'delivered', 'cancelled'],
            description: '订单状态',
          },
          totalAmount: {
            type: 'number',
            minimum: 0,
            description: '订单总金额',
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'string' },
                productName: { type: 'string' },
                quantity: { type: 'integer', minimum: 1 },
                price: { type: 'number', minimum: 0 },
              },
              required: ['productId', 'quantity', 'price'],
            },
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
        },
        required: ['id', 'userId', 'status', 'totalAmount', 'createdAt'],
      },
      CreateOrderRequest: {
        type: 'object',
        description: '创建订单请求',
        properties: {
          userId: {
            type: 'string',
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'string' },
                quantity: { type: 'integer', minimum: 1 },
              },
              required: ['productId', 'quantity'],
            },
          },
        },
        required: ['userId', 'items'],
      },
      Error: {
        type: 'object',
        description: '错误响应',
        properties: {
          error: {
            type: 'string',
            description: '错误类型',
          },
          message: {
            type: 'string',
            description: '错误信息',
          },
          code: {
            type: 'integer',
            description: '错误代码',
          },
        },
        required: ['error', 'message'],
      },
    },
  },
};

export const sampleSpecV2: OpenAPISpec = {
  ...sampleSpecV1,
  info: {
    ...sampleSpecV1.info,
    version: '2.0.0',
    description: '用户管理系统 v2 API',
  },
  paths: {
    ...sampleSpecV1.paths,
    '/users': {
      ...sampleSpecV1.paths['/users'],
      get: {
        ...sampleSpecV1.paths['/users'].get!,
        parameters: [
          ...(sampleSpecV1.paths['/users'].get!.parameters || []),
          {
            name: 'keyword',
            in: 'query',
            description: '搜索关键词',
            required: false,
            schema: {
              type: 'string',
            },
          },
        ],
      },
    },
    '/users/{userId}': {
      ...sampleSpecV1.paths['/users/{userId}'],
      get: {
        summary: '获取用户详情 v2',
        operationId: 'getUserByIdV2',
        tags: ['用户管理'],
        responses: {
          '200': {
            description: '成功返回用户信息',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    email: { type: 'string' },
                    status: { type: 'string', enum: ['active', 'inactive', 'pending', 'banned'] },
                    avatar: { type: 'string', description: '头像URL' },
                    createdAt: { type: 'string' },
                    updatedAt: { type: 'string' },
                  },
                  required: ['id', 'name', 'email', 'status', 'avatar', 'createdAt'],
                },
              },
            },
          },
          '404': {
            description: '用户不存在',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    message: { type: 'string' },
                  },
                  required: ['error', 'message'],
                },
              },
            },
          },
        },
      },
    },
    '/users/{userId}/orders': {
      ...sampleSpecV1.paths['/users/{userId}/orders'],
      get: {
        ...sampleSpecV1.paths['/users/{userId}/orders'].get!,
        parameters: [
          {
            name: 'userId',
            in: 'path',
            description: '用户ID',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'status',
            in: 'query',
            description: '订单状态筛选',
            required: true,
            schema: {
              type: 'string',
              enum: ['pending', 'paid', 'shipped'],
            },
          },
        ],
      },
    },
  },
};

export const breakingChangeSpec: OpenAPISpec = {
  ...sampleSpecV1,
  info: {
    ...sampleSpecV1.info,
    version: '3.0.0',
  },
  paths: {
    '/users': {
      get: {
        summary: '获取用户列表',
        operationId: 'getUsersV3',
        tags: ['用户管理'],
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: '页码',
            required: true,
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: '用户列表',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    users: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                        },
                        required: ['id', 'name'],
                      },
                    },
                  },
                  required: ['users'],
                },
              },
            },
          },
        },
      },
    },
  },
};

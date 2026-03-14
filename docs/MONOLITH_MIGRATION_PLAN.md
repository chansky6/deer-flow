# DeerFlow 全栈单体化迁移方案

  ## 1. 背景

  当前 DeerFlow 对外表现为一个系统，但运行形态仍然是多服务编排：

  - `frontend`：Next.js Web 应用
  - `gateway`：FastAPI REST API，负责模型、配置、技能、上传、制品、鉴权代理
  - `langgraph`：LangGraph 运行时，负责线程、状态、运行、流式事件
  - `nginx`：统一反向代理入口
  - `postgres`：认证和 checkpointer 持久化
  - `provisioner`：可选的 sandbox 基础设施

  这套结构并不是典型“很多独立业务微服务”，而是“一个产品被拆成多个运行单元”。当前最主要的服务边界在
后端：

  - `gateway` 负责非对话 REST 能力
  - `langgraph` 负责线程与 agent runtime
  - `nginx` 负责统一入口和路由分发

  本方案的目标是将 DeerFlow 收敛为**单一交付单元的全栈单体**，降低部署和运维复杂度，同时保持前端和
渠道侧接口兼容。

  ## 2. 单体目标定义

  ### 2.1 目标形态

  本次“单体”定义为：

  - 对外是一个系统、一个域名、一个部署包
  - 对内允许保留 `Next.js` 和 `Python` 两个进程
  - 不再保留 `gateway + langgraph + nginx` 这种应用级拆分
  - `postgres` 和 `provisioner` 视为基础设施，不纳入“业务单体化”范围

  ### 2.2 非目标

  本次改造不包含以下目标：

  - 不追求严格单进程
  - 不重写前端为纯静态页面
  - 不替换 `Next.js + better-auth`
  - 不替换 `Python + LangGraph + FastAPI`
  - 不移除 `Postgres`
  - 不改造 sandbox provider 的基础设施模型

  ## 3. 当前架构现状

  ### 3.1 当前请求链路

  浏览器请求链路：

  `Browser -> Next /bff -> Gateway -> LangGraph`

  公网访问链路：

  `Browser -> Nginx -> Frontend / Gateway / LangGraph`

  IM channel 链路：

  `ChannelManager -> LangGraph SDK / Gateway HTTP`

  ### 3.2 当前职责划分

  #### Frontend

  - 使用 Next.js App Router 提供页面、SSR、BFF 和认证
  - 所有浏览器侧 API 统一走 `/bff/api/*`
  - 前端聊天能力依赖 `@langchain/langgraph-sdk`

  #### Gateway

  - 提供 `/api/models`、`/api/mcp`、`/api/skills`、`/api/memory`、`/api/config`、`/api/threads/*`
等 REST 接口
  - 提供 `/api/langgraph/*` 代理
  - 在代理层完成内部 JWT 鉴权、线程所有权过滤、run context 注入

  #### LangGraph

  - 负责线程创建、状态存储、历史查询、run 生命周期、SSE 流式输出
  - 由 `lead_agent` 作为运行时入口
  - 依赖 checkpointer 提供多轮会话持久化

  #### Nginx

  - 把 `/api/langgraph/*` 转发到 LangGraph
  - 把其他 `/api/*` 转发到 Gateway
  - 把 `/` 转发到 Frontend

  ### 3.3 当前真实耦合点

  当前系统的高耦合点不是页面层，而是以下三类协议：

  1. 前端对 LangGraph 线程协议的依赖
  2. Gateway 对 LangGraph 的代理和上下文注入
  3. IM channel 对 LangGraph URL 与 Gateway URL 的双地址依赖

  其中前端实际使用到的 LangGraph 能力包括：

  - `threads.create`
  - `threads.search`
  - `threads.delete`
  - `threads.getState`
  - `threads.updateState`
  - `threads.getHistory`
  - `runs.stream`
  - `runs.joinStream`
  - `runs.cancel`
  - `runs.wait`

  此外，前端还依赖以下行为语义：

  - `Content-Location` 返回 run 标识
  - SSE 支持 `Last-Event-ID`
  - 页面刷新后可通过 `joinStream` 重新接入流
  - 线程历史和最新状态可并存读取

  ## 4. 目标架构

  ### 4.1 目标运行拓扑

  目标拓扑如下：

  - `app`：单一交付单元，包含：
    - `Next.js` 公网入口
    - `Python Monolith API`
  - `postgres`：认证、线程索引、checkpointer、事件持久化
  - `provisioner`：可选 sandbox 基础设施

  目标请求链路：

  `Browser -> Next /bff -> Python Monolith`

  目标公网链路：

  `Browser -> Next -> Python Monolith`

  目标 channel 链路：

  `ChannelManager -> RuntimeFacade`

  ### 4.2 目标职责划分

  #### Next.js

  - 继续承担页面、SSR、`better-auth`、BFF
  - 替代 nginx 成为唯一公网入口
  - 通过 server route 把 `/api/*`、`/docs`、`/openapi.json`、`/health` 转发到本机 Python 端口

  #### Python Monolith

  - 成为唯一后端进程
  - 直接提供当前 Gateway 的所有 REST 接口
  - 直接提供 LangGraph 兼容接口，不再代理
  - 统一管理线程、运行、状态、流式和事件重放
  - 向前端和 channel 暴露兼容协议，向内统一调用运行时服务

  ### 4.3 保持兼容的外部接口

  以下接口对外保持不变：

  - `/bff/api/*`
  - `/api/models`
  - `/api/mcp/*`
  - `/api/skills/*`
  - `/api/memory/*`
  - `/api/config/*`
  - `/api/threads/{thread_id}/uploads/*`
  - `/api/threads/{thread_id}/artifacts/*`
  - `/api/langgraph/*`
  - `/docs`
  - `/openapi.json`
  - `/health`

  兼容原则：

  - 前端页面、hooks、`LangGraphClient` 调用代码不作为首轮改造目标
  - IM channel 保持现有功能语义不变
  - 仅允许后端内部实现重构，不允许先改外部协议

  ## 5. 影响评估

  ### 5.1 前端影响

  影响等级：中

  影响点：

  - 浏览器仍然通过 `/bff` 访问，不需要改页面路由
  - `LangGraph SDK` 的 API 合约必须被单体后端完整兼容
  - 页面刷新后的流恢复能力必须保留
  - 线程列表、标题更新、重命名、删除依赖新的线程索引表

  结论：

  - 前端 UI 层可基本不动
  - 风险集中在后端兼容层是否正确复刻 LangGraph 协议

  ### 5.2 后端影响

  影响等级：高

  影响点：

  - `gateway` 与 `langgraph` 的职责需要合并
  - `/api/langgraph/*` 从代理实现改为本地实现
  - 运行时上下文注入从“代理改包”改为“内部统一注入”
  - 线程、run、事件要形成单体自己的权威模型

  结论：

  - 后端是本次改单体的主要工作面
  - 需要新增运行时门面、线程仓储、run 仓储和事件存储

  ### 5.3 数据层影响

  影响等级：高

  影响点：

  - 现有 `thread_owners` 仅记录所有权，不足以支撑单体后的线程索引
  - 需要新增线程表、run 表、事件表
  - 需要把旧线程数据从现有 LangGraph 能力回填到新索引

  结论：

  - 必须新增业务索引层
  - checkpointer 继续作为状态真源，但不再承担列表检索入口职责

  ### 5.4 认证与租户隔离影响

  影响等级：中

  影响点：

  - `better-auth` 仍留在 Next.js
  - Python 后端继续校验内部 JWT
  - 线程所有权控制改为统一读新线程索引表
  - run context 注入改为后端内部拼装

  结论：

  - 鉴权机制保留
  - 所有权数据模型要升级

  ### 5.5 IM channel 影响

  影响等级：中

  影响点：

  - `ChannelManager` 当前同时依赖 `langgraph_url` 和 `gateway_url`
  - 单体后应改为直接调用内部运行时门面
  - `/models`、`/memory` 等命令不再经过 HTTP 回环

  结论：

  - channel 行为不变
  - 实现从“双 URL 依赖”改为“单体内调用”

  ### 5.6 部署与运维影响

  影响等级：高

  影响点：

  - 移除 nginx 应用层路由职责
  - compose、Dockerfile、Makefile、健康检查全部需要重写
  - 日志采集从多容器汇聚改为单应用包双进程管理
  - CI 需要新增单体 smoke test

  结论：

  - 运行拓扑会显著简化
  - 部署脚本和运维文档需要同步更新

  ## 6. 关键设计

  ### 6.1 单体后端内部模块

  单体后端新增以下内部抽象：

  #### RuntimeFacade

  统一对外提供：

  - 线程创建
  - 线程删除
  - 线程搜索
  - 状态读取
  - 状态更新
  - 历史读取
  - run 创建
  - run 流式执行
  - run 等待
  - run 取消
  - run 重连

  #### ThreadRepository

  负责线程索引表读写：

  - 所有权
  - 标题
  - 更新时间
  - 元数据
  - 最新 values 缓存
  - 可见性

  #### RunRepository

  负责 run 生命周期：

  - `queued`
  - `running`
  - `completed`
  - `failed`
  - `cancelled`

  #### RunEventStore

  负责 SSE 事件落库与重放：

  - 事件顺序号
  - `event_id`
  - event 类型
  - event payload
  - 按 run 重放
  - `Last-Event-ID` 续传

  ### 6.2 状态真源与索引分层

  状态分层原则：

  - checkpointer：线程状态和历史的真源
  - `threads.values_cache`：列表和快速查询缓存
  - `run_events`：流式事件重放缓存

  不得把 `values_cache` 当作真实历史源。

  ### 6.3 线程与运行模型

  新增以下数据库表：

  #### `threads`

  字段：

  - `thread_id`
  - `owner_user_id`
  - `legacy`
  - `assistant_id`
  - `title`
  - `status`
  - `metadata`
  - `values_cache`
  - `created_at`
  - `updated_at`
  - `deleted_at`

  说明：

  - `owner_user_id` 允许为空，用于保留 legacy admin-only 线程
  - `legacy=true` 表示非新索引原生创建的数据

  #### `thread_runs`

  字段：

  - `run_id`
  - `thread_id`
  - `assistant_id`
  - `status`
  - `stream_modes`
  - `started_at`
  - `finished_at`
  - `error`
  - `last_event_id`

  #### `run_events`

  字段：

  - `run_id`
  - `seq`
  - `event_id`
  - `event`
  - `namespace`
  - `data`
  - `created_at`

  约束：

  - `(run_id, seq)` 唯一
  - `(run_id, event_id)` 唯一

  ### 6.4 兼容 API 范围

  单体后端必须完整支持当前仓库实际使用到的接口：

  - `POST /api/langgraph/threads`
  - `POST /api/langgraph/threads/search`
  - `DELETE /api/langgraph/threads/{thread_id}`
  - `GET /api/langgraph/threads/{thread_id}/state`
  - `POST /api/langgraph/threads/{thread_id}/state`
  - `PATCH /api/langgraph/threads/{thread_id}/state`
  - `POST /api/langgraph/threads/{thread_id}/history`
  - `POST /api/langgraph/threads/{thread_id}/runs/stream`
  - `POST /api/langgraph/threads/{thread_id}/runs/wait`
  - `GET /api/langgraph/threads/{thread_id}/runs/{run_id}/stream`
  - `POST /api/langgraph/threads/{thread_id}/runs/{run_id}/cancel`
  - `GET /api/langgraph/threads/{thread_id}/runs/{run_id}/join`

  不要求首轮复刻全部官方 LangGraph 公共接口。

  ### 6.5 流式执行模型

  单体后端统一采用“先注册 run，再消费事件”的模型：

  1. 接到 run 请求后生成 `run_id`
  2. 写入 `thread_runs`
  3. 后台任务执行图运行
  4. 每个流式事件写入 `run_events`
  5. 当前连接实时消费事件
  6. 断线后通过 `Last-Event-ID` 和 `joinStream` 补拉

  兼容要求：

  - 初次创建流时返回 `Content-Location`
  - 支持 `joinStream`
  - 支持 `cancel`
  - 支持前端刷新后自动重连

  ## 7. 实施方案

  ### 阶段 0：冻结边界与补齐文档

  目标：

  - 冻结当前前端真实使用到的 LangGraph 接口
  - 冻结 `/api/*` 与 `/api/langgraph/*` 兼容范围
  - 明确单体定义与非目标

  产出：

  - 本方案文档
  - API 契约清单
  - 迁移任务拆分

  验收：

  - 兼容接口列表形成基线
  - 不再新增新的后端分拆接口

  ### 阶段 1：建立单体后端基础能力

  目标：

  - 在 Python 侧建立 `RuntimeFacade`
  - 新增 `threads`、`thread_runs`、`run_events` 三张表
  - 抽离统一的线程索引、run 管理和事件重放能力

  实施：

  - 保留现有 `gateway` 进程作为唯一后端入口雏形
  - 新增门面层，统一收敛运行时调用
  - 新增 repository 层和迁移脚本

  验收：

  - 后端内部已经可以不依赖 `LANGGRAPH_UPSTREAM_URL` 组织运行时能力
  - 新建线程和新建 run 可在新索引层落库

  ### 阶段 2：落地 LangGraph 兼容层

  目标：

  - 把 `/api/langgraph/*` 从代理改为本地实现
  - 保持前端 `LangGraph SDK` 无感切换

  实施：

  - 使用 `RuntimeFacade` 实现线程、状态、历史、流式和重连
  - 在本地统一注入 `thread_id`、`user_id`、`email`、`is_admin`
  - 用 `run_events` 支持 `joinStream`

  验收：

  - 前端无需改代码即可完成新建会话、继续会话、重命名、删除、刷新恢复
  - `/api/langgraph/*` 不再访问独立 LangGraph 进程

  ### 阶段 3：完成线程索引迁移

  目标：

  - 把现有线程所有权和会话索引迁入新表
  - 保留 legacy 数据访问能力

  实施：

  - 先迁移 `thread_owners` 到 `threads`
  - 增加一次性回填任务：在切换前通过现有 LangGraph API 以管理员身份枚举现有线程，回填 `title`、
`updated_at`、`values_cache`
  - 对回填不到的线程写入最小索引记录，标记为 `legacy=true`
  - 切换后对 direct access 到的 legacy 线程做惰性补全

  验收：

  - 普通用户能看到自己已有线程
  - 管理员能看到历史 legacy 线程
  - 不因索引迁移丢失已存在会话入口

  ### 阶段 4：收敛前端入口

  目标：

  - 用 Next.js 替代 nginx 成为唯一公网入口
  - 单体应用对外只暴露一个 Web 入口

  实施：

  - 在 Next server route 中统一透传 `/api/*`、`/docs`、`/openapi.json`、`/health`
  - `/bff` 继续保留
  - 移除 nginx 对应用层流量分发的职责

  验收：

  - 本地和生产环境都不再依赖 nginx 转发应用流量
  - 浏览器访问路径不变

  ### 阶段 5：收敛 IM channel 和运维脚本

  目标：

  - 把 channel 侧从双 URL 依赖改为单体内调用
  - 把部署和开发脚本切到单体模式

  实施：

  - `ChannelManager` 改为直接调用 `RuntimeFacade`
  - Compose 由 `frontend + gateway + langgraph + nginx` 收敛为 `app + postgres + optional
provisioner`
  - 新增单体镜像启动方式
  - 重写 `make dev` / `make docker-start` 的单体版

  验收：

  - channel 功能保持不变
  - 开发和生产环境都可以用单体包启动

  ### 阶段 6：移除旧架构残留

  目标：

  - 删除独立 LangGraph 进程依赖
  - 删除应用层 nginx 配置
  - 删除旧的代理配置项

  实施：

  - 移除 `LANGGRAPH_UPSTREAM_URL`
  - 废弃 channels 配置中的 `langgraph_url`、`gateway_url`
  - 移除 compose 中的 `gateway`、`langgraph`、`nginx` 服务定义
  - 删除后端 LangGraph 代理实现

  验收：

  - 仓库中不存在运行时双后端依赖
  - 单体交付链路成为唯一推荐方式

  ## 8. 数据迁移策略

  ### 8.1 迁移原则

  - 先建新索引，再切流量
  - 先兼容，后移除旧实现
  - checkpointer 数据不搬迁，只补索引
  - 任何无法完整回填的历史线程都至少保留 direct access 能力

  ### 8.2 迁移步骤

  1. 创建新表
  2. 把 `thread_owners` 迁入 `threads`
  3. 在旧架构仍可用时执行回填任务
  4. 回填线程标题、更新时间、最新状态缓存
  5. 切换 `/api/langgraph/*` 到本地实现
  6. 观察稳定后删除旧表和旧代理实现

  ### 8.3 回滚策略

  回滚条件：

  - `/api/langgraph/*` 契约不兼容
  - SSE 重连不稳定
  - 线程列表或历史数据异常
  - channel 行为回退

  回滚方式：

  - 保留旧 `gateway -> langgraph` 代理代码直到单体稳定
  - 用配置开关切回旧代理路径
  - 新索引表保留，不删除
  - 旧 `thread_owners` 在回滚窗口内保留只读

  ## 9. 测试与验收标准

  ### 9.1 契约测试

  必须覆盖：

  - 创建线程
  - 搜索线程
  - 删除线程
  - 更新标题
  - 更新 state
  - 读取 state
  - 读取 history
  - 创建流式 run
  - 刷新后 `joinStream`
  - 取消 run

  通过标准：

  - 前端现有 hooks 无需改动即可通过测试

  ### 9.2 前端端到端测试

  必须覆盖：

  - 新建聊天
  - 历史聊天恢复
  - 标题自动更新
  - 上传文件
  - artifact 下载
  - framework review 确认流
  - 页面刷新后恢复流
  - 管理页配置读写

  ### 9.3 Channel 测试

  必须覆盖：

  - `/new`
  - 普通消息
  - `/models`
  - `/memory`
  - artifact 返回
  - 并发消息
  - run 异常处理

  ### 9.4 非功能测试

  必须覆盖：

  - 长连接稳定性
  - `Last-Event-ID` 续传
  - 大文件上传
  - run cancel
  - 应用重启后历史会话读取
  - 单镜像启动与健康检查

  ### 9.5 最终验收标准

  只有同时满足以下条件，才允许下线旧架构：

  - 前端无代码改动即可正常工作
  - channel 行为无功能回退
  - `/api/langgraph/*` 不再依赖代理
  - 线程搜索、标题、历史、流恢复全部正常
  - 单体部署链路通过 smoke test

  ## 10. 风险与应对

  ### 风险 1：LangGraph 协议兼容不完整

  表现：

  - 前端聊天页能加载但流式、重连或历史异常

  应对：

  - 先基于当前前端真实调用面做契约测试
  - 只兼容仓库已使用接口，不盲目追求完整 API 复刻

  ### 风险 2：线程历史回填不完整

  表现：

  - 老线程缺标题、缺更新时间、搜索不到

  应对：

  - 在切流前执行一次性回填
  - 对遗漏线程保留管理员 direct access + 惰性补全

  ### 风险 3：SSE 重连不稳定

  表现：

  - 页面刷新后无法继续接流
  - 重复消息或漏消息

  应对：

  - 所有流事件落 `run_events`
  - 强制实现 `event_id`、顺序号和 `Last-Event-ID` 续传

  ### 风险 4：Next 替代 nginx 后入口处理不完整

  表现：

  - `/docs`、`/health`、`/openapi.json` 或文件上传异常

  应对：

  - 把这些路径纳入统一 server route 转发测试
  - 上线前做完整 smoke test

  ## 11. 结论

  - 把 `gateway`、`langgraph`、`nginx` 这几个应用级运行单元收敛掉
  - 保留外部接口不变，降低改造风险

  推荐按“先兼容、后切换、再清理”的方式推进，避免一次性重写前端接入层和运行时协议。只要线程索引、流
事件重放和 LangGraph 兼容接口这三块做稳，DeerFlow 可以在不改变用户使用方式的前提下完成单体化。

  ## 说明

  - 下一步如果你要我真正落库，我会按这个稿子创建 docs/MONOLITH_MIGRATION_PLAN.md。
  - 默认不额外拆成 backend/docs/ 子文档；只有你希望把实现细节再拆成后端专项设计时，才补第二份子
    文档。

  ## 假设

  - 文档先以“总体迁移方案”形态落在根目录 docs/。
  - 当前这一步只产出正式文档稿，不进入代码修改和文件写入。
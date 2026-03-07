# LangGraph Human-in-the-Loop 调研

## 背景

本文档调研 DeerFlow 项目中与 LangGraph Human-in-the-Loop（HITL）相关的实现，重点回答两个问题：

1. LangGraph 官方语境下的 HITL 是什么。
2. 当前项目中哪里实际使用了类似能力，以及它与官方模式有什么差异。

调研时间：2026-03-07

## LangGraph 官方 HITL 概念

LangGraph 官方的 Human-in-the-Loop 通常指：

- 在图执行过程中，某个节点主动暂停执行。
- 暂停点状态由 checkpointer 持久化。
- 外部系统或前端收到中断信号后，向用户展示待确认信息。
- 用户给出输入、审批或修改意见后，再通过恢复命令继续同一条图执行链路。

常见官方模式包括：

### 1. `interrupt()` / `resume` 模式

典型流程如下：

- 节点调用 `interrupt(...)` 暂停。
- LangGraph 返回中断载荷（常见为 `__interrupt__` 相关状态）。
- 前端或服务端收集用户输入。
- 外部再以 `Command(resume=...)` 恢复原执行上下文。

这种模式的关键点是：

- 暂停和恢复发生在同一条 graph execution 内。
- 恢复不是开启一轮全新对话，而是继续之前被挂起的节点。

### 2. 工具审批型 HITL Middleware

LangChain / LangGraph 生态里还存在另一类更偏“人审工具调用”的模式，例如：

- 对 `bash`、`write_file`、外部 API 调用等高风险工具先进行拦截。
- 把待执行操作展示给人类审批。
- 人类选择 `approve`、`edit` 或 `reject`。
- agent 再依据审批结果继续执行。

这类能力适合高风险、强审计、需要人工把关的场景。

## 本项目中的实际落地方式

### 总体判断

DeerFlow 当前**没有使用 LangGraph 官方原生的 `interrupt()` + `resume` 模式**，也**没有使用官方工具审批式 Human-in-the-Loop middleware**。

项目里实际落地的是两套**自定义 HITL**：

- **澄清式 HITL**：当模型判断用户需求缺失信息、存在歧义或需要确认时，调用 `ask_clarification`。
- **结构化框架审阅 HITL**：当 consulting-analysis 在 Phase 1 产出完整框架后，调用 `request_framework_review`。
- 两者都由后端中间件拦截，并通过 `Command(goto=END)` 终止当前回合。
- 前端分别把它们渲染为显式问题或可编辑框架审阅卡片，等待用户后续操作继续。

因此，这更接近：

- **“通过中断当前回合来发起澄清”**，而不是
- **“在同一条 graph execution 内 pause / resume”**。

## 具体使用点

### 1. Prompt 层：强制先澄清再执行

Lead agent 的系统提示词明确规定：如果信息不完整、需求含糊、存在多种实现路径或涉及风险操作，模型必须先调用 `ask_clarification`，再开始做事。

关键位置：

- `backend/src/agents/lead_agent/prompt.py:165`
- `backend/src/agents/lead_agent/prompt.py:166`
- `backend/src/agents/lead_agent/prompt.py:173`
- `backend/src/agents/lead_agent/prompt.py:206`

这里的规则包括：

- Clarify → Plan → Act
- 信息缺失必须提问
- 有歧义必须提问
- 有方案选择必须提问
- 有风险操作必须确认
- 调用 `ask_clarification` 后会自动中断当前执行

### 2. 工具注册：`ask_clarification` 是内置工具

`ask_clarification` 被作为内置工具注册进 agent，可被模型直接调用。

关键位置：

- `backend/src/tools/tools.py:11`
- `backend/src/tools/tools.py:13`
- `backend/src/tools/tools.py:22`

说明：

- `BUILTIN_TOOLS` 中直接包含 `ask_clarification_tool`
- 它与 `present_file_tool` 一起属于默认内置工具

### 3. 工具定义：工具本体只是占位

`ask_clarification` 的工具函数本身并不负责真正的中断逻辑，它只是一个占位入口，真正行为由中间件接管。

关键位置：

- `backend/src/tools/builtins/clarification_tool.py:6`
- `backend/src/tools/builtins/clarification_tool.py:29`
- `backend/src/tools/builtins/clarification_tool.py:52`

工具定义提供了如下参数：

- `question`
- `clarification_type`
- `context`
- `options`

支持的澄清类型包括：

- `missing_info`
- `ambiguous_requirement`
- `approach_choice`
- `risk_confirmation`
- `suggestion`

### 4. 核心实现：`ClarificationMiddleware`

真正的 HITL 逻辑集中在澄清中间件中。

关键位置：

- `backend/src/agents/middlewares/clarification_middleware.py:20`
- `backend/src/agents/middlewares/clarification_middleware.py:46`
- `backend/src/agents/middlewares/clarification_middleware.py:91`
- `backend/src/agents/middlewares/clarification_middleware.py:126`
- `backend/src/agents/middlewares/clarification_middleware.py:131`
- `backend/src/agents/middlewares/clarification_middleware.py:153`

其执行流程如下：

1. 拦截名为 `ask_clarification` 的 tool call。
2. 从 tool args 中提取 `question`、`context`、`options`、`clarification_type`。
3. 组装为更适合展示的文本消息。
4. 构造一条 `ToolMessage(name="ask_clarification")` 写入消息历史。
5. 返回 `Command(update={"messages": [tool_message]}, goto=END)`，直接结束当前回合。

这里最关键的是：

- 它使用了 `langgraph.types.Command`
- 但**不是** `Command(resume=...)`
- 而是 `goto=END`
- 也**没有**调用官方 `interrupt()` API

也就是说，当前逻辑是“结束当前执行并展示提问”，不是“挂起节点等待恢复”。

### 5. Agent 装配：中间件挂在 lead agent 最后

`ClarificationMiddleware` 在 lead agent 中被明确要求放在 middleware 链的最后，以便在模型产生工具调用后统一拦截。

关键位置：

- `backend/src/agents/lead_agent/agent.py:203`
- `backend/src/agents/lead_agent/agent.py:211`
- `backend/src/agents/lead_agent/agent.py:253`
- `backend/src/agents/lead_agent/agent.py:304`
- `backend/src/agents/lead_agent/agent.py:307`

这说明它是正式的 agent 执行链一部分，不是旁路逻辑。

### 6. 前端识别：把澄清工具消息单独分组

前端不会把 `ask_clarification` 当作普通工具返回，而是单独识别并分组。

关键位置：

- `frontend/src/core/messages/utils.ts:224`
- `frontend/src/core/messages/utils.ts:48`
- `frontend/src/core/messages/utils.ts:58`

前端判断规则非常直接：

- 只要 `message.type === "tool"`
- 且 `message.name === "ask_clarification"`
- 就认为这是一条需要特殊展示的澄清消息

### 7. 前端展示：把澄清问题显式渲染给用户

澄清消息在消息列表中会被渲染为单独一块 Markdown 内容，而不是隐藏在普通 CoT 流里。

关键位置：

- `frontend/src/components/workspace/messages/message-list.tsx:66`
- `frontend/src/components/workspace/messages/message-list.tsx:70`

此外，在“思考 / 工具调用”展示区，`ask_clarification` 也会显示为一个 `need your help` 的步骤。

关键位置：

- `frontend/src/components/workspace/messages/message-group.tsx:396`

这说明前端已经围绕当前这套“澄清式 HITL”做了专门 UI 适配。

### 8. 用户后续输入：继续走普通提交链路

用户回答澄清问题后，前端仍然通过普通 `thread.submit(...)` 发送新一轮 human message。

### 8.5. 结构化框架审阅 HITL（新增）

除了 `ask_clarification` 之外，项目现在还为 `consulting-analysis` 技能加入了一条更稳定的结构化 HITL 链路：

- Lead agent 在分析框架生成完成后调用 `request_framework_review`。
- `FrameworkReviewMiddleware` 拦截该工具调用，向 thread state 写入 `framework_review`，同时返回 `Command(goto=END)` 中断当前回合。
- 前端检测 `thread.values.framework_review` 后，在消息列表中渲染可直接编辑 Markdown 的 `FrameworkReviewCard`。
- 框架待确认期间，普通输入框会被禁用，避免用户绕开确认步骤。
- 用户确认后，前端把 `framework_review` 清空，并把编辑后的 Markdown 写入 `confirmed_analysis_framework`。
- 前端随后自动发送一条继续提示词，进入下一轮正常推理。
- `FrameworkReviewMiddleware` 会在下一次模型调用前，把 `confirmed_analysis_framework` 以临时 `SystemMessage` 形式注入上下文，但不会把这段系统提示持久化到消息历史。

这一方案仍然不是 LangGraph 官方原生 `interrupt()/resume`，但比“让模型理解自然语言修改意见”更稳定，因为框架内容通过结构化状态直接传递。

关键位置：

- `frontend/src/core/threads/hooks.ts:196`
- `frontend/src/core/threads/hooks.ts:213`

虽然这里设置了：

- `streamResumable: true`

但在当前仓库中，没有看到以下任一官方原生恢复能力的使用：

- `interrupt()`
- `Command(resume=...)`
- 显式 `.resume()` 调用
- `__interrupt__` 载荷处理
- 官方 `HumanInTheLoop` middleware

因此，`streamResumable: true` 在这里更像是前端 SDK 的通用流式能力开关，而不是当前澄清流程依赖的原生 resume 机制。

## 当前实现链路总结

将项目里的这套能力串起来，可以得到如下链路：

1. 用户发起请求。
2. 模型根据 prompt 判断信息是否缺失或需要确认。
3. 若需要，模型调用 `ask_clarification`。
4. `ClarificationMiddleware` 拦截该工具调用。
5. 中间件写入一条格式化后的 `ToolMessage`。
6. 中间件返回 `Command(..., goto=END)`，当前回合终止。
7. 前端把该 tool message 渲染为显式问题。
8. 用户继续输入回答。
9. 系统在同一 thread 上进入下一轮正常推理。

## 与 LangGraph 官方原生 HITL 的差异

### 当前实现的特点

优点：

- 实现简单，易于落地。
- 与现有聊天 UI 高度兼容。
- 不要求前端显式处理 `__interrupt__` 或 `resume` 指令。
- 很适合“需求澄清”这一类轻量人机交互。

局限：

- 不是严格意义上的“同一 graph execution 暂停后恢复”。
- 更像多轮对话接力，而不是原生 graph resume。
- 不适合直接扩展为官方那种高风险工具审批流。
- `options` 当前在后端被格式化成纯文本编号列表，前端拿不到结构化选项对象，不利于做按钮式审批或单选式澄清 UI。

### 仓库中未发现的官方模式

本次调研没有在仓库中发现以下使用痕迹：

- `langgraph.types.interrupt`
- 原生 `interrupt(...)`
- `Command(resume=...)`
- `HumanInterrupt`
- `ActionRequest`
- `approve / edit / reject` 型工具审批流
- `__interrupt__` 前端处理逻辑

这进一步说明项目目前采用的是**自定义澄清中断方案**，而非官方标准 HITL runtime 模式。

## 相关配套实现

### `DanglingToolCallMiddleware`

虽然它不是 HITL 主体，但与“执行被提前结束”场景相关。

关键位置：

- `backend/src/agents/middlewares/dangling_tool_call_middleware.py:1`
- `backend/src/agents/middlewares/dangling_tool_call_middleware.py:78`

其作用是：

- 当历史消息中出现 AI 发起了 tool call，但没有对应 ToolMessage 返回时，自动补一条占位 ToolMessage。
- 避免后续模型调用因消息格式不完整而报错。

这对“工具调用被打断”“执行提前结束”之类场景有兜底价值。

## 结论

DeerFlow 当前在 LangGraph Human-in-the-Loop 方向上的实际落地，主要是：

- 一套围绕 `ask_clarification` 构建的**澄清式人参与流程**。
- 一套围绕 `request_framework_review` 构建的**结构化框架审阅流程**。
- 后端分别通过 `ClarificationMiddleware` 与 `FrameworkReviewMiddleware` 拦截并终止当前回合。
- 前端把澄清请求显式展示给用户，并把框架审阅请求渲染为可直接编辑的 Markdown 卡片。
- 用户通过下一条普通消息补充信息，或先确认框架后再自动进入下一轮推理。

如果从能力分层上描述，可以认为项目现在具备：

- **L1：澄清式 HITL** ✅ 已实现
- **L1.5：结构化框架审阅 HITL** ✅ 已实现
- **L2：原生 interrupt / resume 式图内恢复** ❌ 未实现
- **L3：工具审批式 HITL（approve / edit / reject）** ❌ 未实现

## 后续改造建议

如果后续要增强这套能力，建议按优先级分两条路线：

### 路线 A：增强现有澄清式 HITL

适合低改造成本演进，建议包括：

- 保留 `ask_clarification` 模型接口不变。
- 将 `options` 从纯文本格式升级为结构化消息元数据。
- 前端增加按钮式选项、确认框、快捷回复。
- 为不同 `clarification_type` 增加不同视觉样式。
- 补充埋点，记录澄清发起率、用户响应率、澄清完成率。

### 路线 B：迁移到 LangGraph 原生 HITL

适合未来做高风险工具审批或更强状态恢复能力，建议包括：

- 在关键节点内改用官方 `interrupt()`。
- 基于 checkpointer 保证中断状态可恢复。
- 前端增加 `__interrupt__` / 恢复动作处理。
- 对高风险工具建立 `approve / edit / reject` 审批界面。
- 按场景拆分“澄清型中断”和“审批型中断”。

## 参考资料

- LangGraph Human-in-the-Loop 文档：
  - `https://docs.langchain.com/oss/python/langgraph/human-in-the-loop`
- LangGraph Interrupts 文档：
  - `https://docs.langchain.com/oss/javascript/langgraph/interrupts`
- LangChain Human-in-the-Loop 文档：
  - `https://docs.langchain.com/oss/python/langchain/human-in-the-loop`

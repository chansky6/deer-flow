# DeerFlow 架构缺陷分析与改进方案

## 文档概述

本文档分析了 DeerFlow 深度研究框架在实际使用中发现的架构缺陷，并提出相应的改进方案。

**分析日期**: 2026-02-10
**分析版本**: 基于 main 分支 (commit: b92ad7e)

---

## 问题一：搜索内容缺乏审查，直接填充导致 Prompt 爆炸

### 1.1 问题描述

搜索工具返回的内容没有经过充分的审查和过滤，直接填充到 prompt 中，可能导致：
- Token 数量超过 LLM 限制
- 包含大量无关或低质量内容
- 上下文被迫压缩，丢失重要信息
- 增加 API 调用成本

### 1.2 问题验证

通过代码调研，发现以下事实：

**搜索结果处理流程**：
```
搜索 API → SearchResultPostProcessor → ToolMessage → State.messages → ContextManager 压缩
```

**现有保护机制**（`src/tools/search_postprocessor.py`）：
- ✅ 去重（基于 URL）
- ✅ 按相关性分数过滤（`min_score_threshold`）
- ✅ 移除 base64 图片数据
- ✅ 截断长内容（`max_content_length_per_page`）
- ❌ **缺少内容质量审查**
- ❌ **缺少内容相关性二次验证**
- ❌ **缺少敏感信息过滤**

**Context Manager 压缩机制**（`src/utils/context_manager.py`）：
- 当 token 数超过 `token_limit` 时触发
- 优先压缩 `web_search` ToolMessage 的 `raw_content` 到 1024 字符
- 如果仍超限，丢弃中间的旧消息
- ⚠️ **被动压缩，可能丢失重要信息**

**实际问题案例**：
- Issue #721: 消息压缩被频繁触发
- 日志显示：`Message compression executed (Issue #721): 50000 -> 30000 tokens`

### 1.3 根本原因分析

1. **缺少主动内容筛选**
   - 搜索结果只按分数过滤，不验证内容质量
   - 没有检测和移除广告、导航栏等噪音内容
   - 没有提取核心段落，而是保留全文

2. **被动压缩策略**
   - 只在超限时才压缩，而非主动优化
   - 压缩策略简单粗暴（截断或丢弃）
   - 可能丢失关键信息

3. **缺少内容相关性验证**
   - 搜索引擎返回的相关性分数不一定准确
   - 没有使用 LLM 二次验证内容是否真正相关

### 1.4 改进方案

#### 方案 1：智能内容摘要（推荐）

**实现思路**：
在 `SearchResultPostProcessor` 中添加 LLM 驱动的内容摘要功能。

**具体步骤**：
1. 在 `src/tools/search_postprocessor.py` 中添加 `summarize_content()` 方法
2. 对每个搜索结果使用轻量级 LLM（如 GPT-4o-mini）生成摘要
3. 摘要 prompt 包含：
   - 研究主题/查询
   - 提取与主题相关的核心信息
   - 移除广告、导航等噪音
   - 限制摘要长度（如 500 tokens）

**优点**：
- 主动减少无关内容
- 保留关键信息
- 减少后续压缩需求

**缺点**：
- 增加 API 调用成本
- 增加处理延迟

**配置参数**（添加到 `conf.yaml`）：
```yaml
SEARCH_ENGINE:
  enable_content_summarization: true
  summarization_model: "gpt-4o-mini"
  max_summary_length: 500
```

#### 方案 2：基于规则的内容清洗

**实现思路**：
使用启发式规则过滤低质量内容。

**具体步骤**：
1. 检测并移除常见噪音模式：
   - 导航栏（包含 "Home", "About", "Contact" 等）
   - 版权声明
   - Cookie 提示
   - 广告标记（"Advertisement", "Sponsored" 等）
2. 提取主要内容区域（基于 HTML 标签优先级）
3. 计算内容密度，过滤低密度页面

**优点**：
- 无额外 API 成本
- 处理速度快
- 可预测的行为

**缺点**：
- 规则可能不完善
- 难以处理复杂页面结构

#### 方案 3：混合策略（最佳平衡）

**实现思路**：
结合规则清洗和选择性摘要。

**具体步骤**：
1. 第一阶段：规则清洗（快速过滤噪音）
2. 第二阶段：长度检查
   - 如果内容 < 2000 字符：保留原文
   - 如果内容 > 2000 字符：使用 LLM 摘要
3. 第三阶段：相关性验证（可选）
   - 对摘要后的内容计算与查询的相似度
   - 过滤相似度低于阈值的结果

**优点**：
- 平衡成本和效果
- 灵活可配置
- 适应不同场景

**实施优先级**：高 ⭐⭐⭐

---

## 问题二：报告生成依赖 LLM 输出限制，内容简单字数少

### 2.1 问题描述

生成的研究报告质量不稳定，常见问题：
- 报告内容过于简短（通常 < 3000 字）
- 缺乏深度分析和详细论述
- 与官方示例中的长篇报告差距明显
- 无法满足深度研究需求

### 2.2 问题验证

通过代码调研，发现以下限制因素：

**限制因素 1：LLM Token 限制**（`src/graph/nodes.py:837-903`）
```python
# Reporter 节点使用 ContextManager 压缩 observations
llm_token_limit = get_llm_token_limit_by_type(AGENT_LLM_MAP["reporter"])
compressed_state = ContextManager(llm_token_limit).compress_messages(
    {"messages": observation_messages}
)
```

- 输入上下文 = prompt + observations + citations
- 如果 observations 过长，会被压缩或截断
- 压缩可能导致关键研究内容丢失

**限制因素 2：研究步骤数量限制**（`src/config/configuration.py:49`）
```python
max_step_num: int = 3  # Maximum number of steps in a plan
```

- 默认只允许 3 个研究步骤
- 步骤少 → observations 少 → 报告内容少
- 复杂主题无法充分研究

**限制因素 3：Prompt 指令倾向简洁**（`src/prompts/reporter.md`）

大多数报告风格的 prompt 包含 "Be concise and precise" 指令：
- 默认风格没有强制字数要求
- 只有 `strategic_investment` 风格要求 10,000-15,000 字
- LLM 倾向于生成简短回答

**限制因素 4：模型配置**（`conf.yaml`）
```yaml
BASIC_MODEL:
  token_limit: 8000  # 限制输入上下文
```

- 较小的 token_limit 导致输入被压缩
- 模型输出长度受限于模型本身的能力

### 2.3 根本原因分析

1. **输入信息不足**
   - 研究步骤太少（默认 3 个）
   - Observations 被压缩，丢失细节
   - 缺乏足够的研究深度

2. **Prompt 设计问题**
   - 缺少明确的长度要求
   - 缺少详细的章节结构指导
   - 没有强调"深度"和"全面性"

3. **模型选择不当**
   - 使用 BASIC_MODEL 可能能力不足
   - 未启用 REASONING_MODEL 进行深度思考

### 2.4 改进方案

#### 方案 1：增加研究步骤数量

**实现思路**：
提高 `max_step_num` 的默认值和最大限制。

**具体步骤**：
1. 修改 `src/config/configuration.py`：
   ```python
   max_step_num: int = 8  # 从 3 增加到 8
   ```

2. 在 API 中允许用户自定义：
   ```python
   # src/server/chat_request.py
   max_step_num: int = Field(default=8, ge=1, le=15)
   ```

**优点**：
- 简单直接
- 允许更深入的研究
- 生成更多 observations

**缺点**：
- 增加执行时间
- 增加 API 成本

**实施优先级**：高 ⭐⭐⭐

#### 方案 2：优化 Reporter Prompt

**实现思路**：
在所有报告风格中添加明确的长度和深度要求。

**具体步骤**：
1. 修改 `src/prompts/reporter.md`，添加：
   ```markdown
   ## Report Length Requirements
   - Minimum length: 5,000 words for comprehensive topics
   - Each main section should be 800-1,500 words
   - Provide detailed analysis, not just summaries
   ```

2. 强调深度分析：
   ```markdown
   - Include specific examples and case studies
   - Provide data-driven insights
   - Explain the "why" behind findings
   ```

**优点**：
- 无需代码修改
- 立即生效
- 可针对不同风格定制

**实施优先级**：高 ⭐⭐⭐

#### 方案 3：使用大上下文模型

**实现思路**：
配置支持更大 token 限制的模型。

**具体步骤**：
在 `conf.yaml` 中配置：
```yaml
BASIC_MODEL:
  model_name: "gpt-4-turbo"
  token_limit: 128000  # 从 8000 增加到 128K

AGENT_LLM_MAP:
  reporter: "basic"  # 或使用 reasoning 模型
```

**优点**：
- 避免上下文压缩
- 保留所有研究细节
- 支持更长输出

**缺点**：
- 增加 API 成本
- 需要支持的模型

**实施优先级**：中 ⭐⭐

#### 方案 4：分层报告生成（创新方案）

**实现思路**：
先生成详细大纲，再逐章节生成内容，最后合并。

**具体步骤**：
1. 第一阶段：Reporter 生成详细大纲（包含章节标题和要点）
2. 第二阶段：为每个章节单独调用 LLM 生成详细内容
3. 第三阶段：合并所有章节，生成完整报告

**优点**：
- 突破单次输出长度限制
- 每个章节可以更详细
- 可并行生成章节（提高速度）

**缺点**：
- 需要修改 reporter 节点逻辑
- 增加 API 调用次数
- 章节间可能缺乏连贯性

**实施优先级**：中 ⭐⭐

---

## 问题三：Planner 生成的大纲限定死章节数，无法根据用户框架生成

### 3.1 问题描述

当用户提供完整的研究大纲或框架时，系统无法识别和使用：
- Planner 总是自己生成新的研究计划
- 步骤数量被硬编码限制（默认 3 个）
- 用户提供的章节结构被忽略
- 无法按照用户指定的框架进行研究

**示例场景**：
用户输入：
```
请按以下大纲研究 AI 市场：
1. 市场规模与增长趋势
2. 主要参与者分析
3. 技术发展路线
4. 投资机会评估
5. 风险与挑战
6. 未来展望
```

系统行为：
- 忽略用户的 6 个章节
- 生成自己的 3 个研究步骤
- 可能与用户意图不符

### 3.2 问题验证

通过代码调研，发现以下事实：

**硬编码的步骤数量限制**（`src/config/configuration.py:49`）：
```python
max_step_num: int = 3  # Maximum number of steps in a plan
```

**Planner Prompt 强制限制**（`src/prompts/planner.md:163`）：
```markdown
## Step Constraints
- **Maximum Steps**: Limit the plan to a maximum of {{ max_step_num }} steps
```

**缺少大纲检测逻辑**：
- Coordinator 节点（`src/graph/nodes.py:549-834`）不检测用户提供的大纲
- Planner 节点（`src/graph/nodes.py:266-394`）总是生成新计划
- State 定义（`src/graph/types.py`）没有 `user_provided_outline` 字段

**Planner 提示词分析**（`src/prompts/planner.md`）：
- 没有"检测用户大纲"的指令
- 没有"使用用户提供的框架"的逻辑
- 总是要求 LLM 生成新的 Plan 对象

### 3.3 根本原因分析

1. **缺少大纲检测机制**
   - Coordinator 不识别用户输入中的大纲结构
   - 没有解析编号列表、章节标题等模式
   - 无法区分"自由提问"和"结构化大纲"

2. **工作流设计固定**
   - Coordinator → Planner → Research Team 的流程固定
   - Planner 总是被调用，没有"跳过规划"的路径
   - 无法直接使用用户大纲

3. **步骤数量硬限制**
   - `max_step_num` 默认为 3，限制太严格
   - 即使 LLM 想生成更多步骤，也会被截断
   - 无法适应不同复杂度的研究任务

### 3.4 改进方案

#### 方案 1：在 Coordinator 中添加大纲检测

**实现思路**：
让 Coordinator 识别用户是否提供了大纲，并提取章节结构。

**具体步骤**：
1. 修改 Coordinator prompt（`src/prompts/coordinator.md`），添加：
   ```markdown
   ## Outline Detection
   Check if the user has provided a structured outline with:
   - Numbered lists (1. 2. 3. or 1) 2) 3))
   - Chapter titles or section headings
   - Clear hierarchical structure

   If outline detected, extract it and pass to planner.
   ```

2. 在 State 中添加字段（`src/graph/types.py`）：
   ```python
   user_provided_outline: Optional[List[str]] = None
   use_user_outline: bool = False
   ```

**优点**：
- 尊重用户意图
- 提高灵活性
- 保持现有流程

**缺点**：
- 需要修改多个文件
- 大纲解析可能不准确

**实施优先级**：高 ⭐⭐⭐

#### 方案 2：修改 Planner 支持用户大纲模式

**实现思路**：
在 Planner 中添加两种模式：自动规划模式和用户大纲模式。

**具体步骤**：
1. 修改 Planner prompt（`src/prompts/planner.md`），添加：
   ```markdown
   ## User Outline Mode
   If `user_provided_outline` is present in the state:
   - Convert each outline item to a research Step
   - Preserve the user's chapter structure
   - Assign appropriate step_type for each item
   - Set need_search based on content requirements
   ```

2. 修改 Planner 节点逻辑（`src/graph/nodes.py`）：
   ```python
   if state.get("use_user_outline") and state.get("user_provided_outline"):
       # 使用用户大纲生成 Plan
       steps = convert_outline_to_steps(state["user_provided_outline"])
   else:
       # 现有逻辑：LLM 生成计划
   ```

**优点**：
- 完全遵循用户意图
- 灵活切换模式
- 保持向后兼容

**实施优先级**：高 ⭐⭐⭐（方案2）

#### 方案 3：提高步骤数量限制（快速修复）

**实现思路**：
简单提高 `max_step_num` 的默认值和上限。

**具体步骤**：
修改 `src/config/configuration.py`：
```python
max_step_num: int = 10  # 从 3 提高到 10
```

修改 API 验证（`src/server/chat_request.py`）：
```python
max_step_num: int = Field(default=10, ge=1, le=20)
```

**优点**：
- 实施简单，立即生效
- 允许更复杂的研究计划
- 无需修改工作流逻辑

**缺点**：
- 治标不治本
- 仍然无法识别用户大纲
- 增加执行时间和成本

**实施优先级**：高 ⭐⭐⭐（快速修复）

#### 方案 4：动态调整步骤数量

**实现思路**：
根据研究主题的复杂度自动调整 `max_step_num`。

**具体步骤**：
1. 在 Coordinator 中评估主题复杂度
2. 根据复杂度设置 `max_step_num`：
   - 简单主题：3-5 步
   - 中等主题：6-10 步
   - 复杂主题：11-15 步

**优点**：
- 智能适应不同场景
- 优化成本和效果平衡

**缺点**：
- 复杂度评估可能不准确
- 需要额外的 LLM 调用

**实施优先级**：中 ⭐⭐

---

## 问题四：报告生成后缺少交互式微调功能

### 4.1 问题描述

当最终报告生成后，用户无法通过自然语言与系统交互进行微调，存在以下问题：
- 无法对报告进行局部修改或优化
- 不支持按段落或章节进行小范围调整
- 修改报告可能导致引用文献失效或不一致
- 用户只能重新发起完整的研究流程

**典型场景**：
- 用户："请在第二章增加更多关于 GPT-4 的案例"
- 用户："第三段的数据有误，请更正"
- 用户："参考文献格式需要改为 APA 格式"

### 4.2 问题验证

通过代码调研，发现以下事实：

**工作流结束逻辑**（`src/graph/builder.py:69`）：
```python
builder.add_edge("reporter", END)
```

- Reporter 节点直接连接到 END
- 工作流在报告生成后立即结束
- 没有任何后续交互节点

**State 字段缺失**（`src/graph/types.py`）：
- ✅ 有 `final_report` 字段存储报告
- ❌ 没有 `report_history` 字段
- ❌ 没有 `report_modifications` 字段
- ❌ 没有 `report_feedback` 字段

**API 交互能力**（`src/server/app.py`）：
- ✅ 支持多轮对话（通过 `thread_id` 和 `messages`）
- ✅ 支持 checkpoint 机制恢复会话
- ❌ 没有专用的"编辑报告"端点
- ❌ 报告修改需要通过主聊天端点，但工作流已结束

**引用管理机制**（`src/citations/`）：
- ✅ 完善的引用提取和存储机制
- ✅ 引用与报告内容关联
- ❌ 修改报告后无法自动更新引用
- ❌ 缺少引用验证和同步机制

### 4.3 根本原因分析

1. **单向线性工作流**
   - 工作流设计为单向流程：START → ... → Reporter → END
   - Reporter 是终点节点，没有返回路径
   - 无法支持报告后的迭代优化

2. **缺少报告编辑节点**
   - 没有 "report_editor" 或 "report_refiner" 节点
   - 没有处理局部修改的逻辑
   - 无法识别用户的修改意图（全局 vs 局部）

3. **引用同步问题**
   - 引用在研究阶段收集，与报告内容关联
   - 修改报告后，引用可能失效或不准确
   - 缺少引用验证和更新机制

4. **状态管理不足**
   - State 中没有追踪报告修改历史的字段
   - 无法记录用户的修改请求和反馈
   - 难以实现版本控制和回滚

### 4.4 改进方案

#### 方案 1：添加报告编辑节点（推荐）

**实现思路**：
在工作流中添加 report_editor 节点，支持报告后的交互式编辑。

**具体步骤**：
1. 修改工作流结构（`src/graph/builder.py`）：
   ```python
   # 将 reporter → END 改为条件边
   builder.add_conditional_edges(
       "reporter",
       should_continue_editing,
       {
           "edit": "report_editor",
           "end": END
       }
   )
   builder.add_edge("report_editor", "reporter")  # 循环优化
   ```

2. 创建 report_editor 节点（`src/graph/nodes.py`）：
   - 识别用户的修改意图（全局/局部）
   - 提取需要修改的段落或章节
   - 调用 LLM 进行局部修改
   - 保持其他部分不变

3. 扩展 State 定义（`src/graph/types.py`）：
   ```python
   report_history: list[str] = field(default_factory=list)
   modification_requests: list[str] = field(default_factory=list)
   editing_mode: bool = False
   ```

**优点**：
- 支持迭代优化报告
- 保留修改历史
- 可以多轮交互

**缺点**：
- 需要重构工作流
- 增加系统复杂度
- 可能增加执行时间

**实施优先级**：高 ⭐⭐⭐（方案1）

#### 方案 2：利用现有 Checkpoint 机制（快速实现）

**实现思路**：
利用现有的多轮对话和 checkpoint 机制，通过主聊天端点实现报告修改。

**具体步骤**：
1. 用户发起修改请求时，使用相同的 `thread_id`
2. 系统检测到 `final_report` 已存在，进入编辑模式
3. 使用 LLM 理解修改意图并生成新版本报告
4. 保存修改历史到 checkpoint

**优点**：
- 无需修改工作流结构
- 利用现有基础设施
- 实施简单快速

**缺点**：
- 每次修改都重新生成完整报告
- 效率较低
- 难以精确控制局部修改

**实施优先级**：高 ⭐⭐⭐（方案2-快速修复）

#### 方案 3：段落级编辑系统

**实现思路**：
实现细粒度的段落级编辑，支持精确修改特定章节。

**具体步骤**：
1. 报告生成时添加段落标识符：
   ```markdown
   <!-- section:introduction -->
   ## Introduction
   ...
   <!-- /section:introduction -->
   ```

2. 创建段落解析器：
   - 解析报告结构
   - 提取段落边界
   - 建立段落索引

3. 实现局部修改逻辑：
   - 识别需要修改的段落
   - 只重新生成该段落
   - 保持其他段落不变

**优点**：
- 精确控制修改范围
- 效率高，只修改必要部分
- 减少 token 消耗

**缺点**：
- 实现复杂度高
- 需要段落边界识别
- 可能影响段落间连贯性

**实施优先级**：中 ⭐⭐（方案3）

#### 方案 4：引用同步机制

**实现思路**：
在报告修改时自动验证和更新引用文献。

**具体步骤**：
1. 创建引用追踪器（`src/citations/tracker.py`）：
   ```python
   class CitationTracker:
       def extract_used_citations(report: str) -> List[str]
       def validate_citations(report: str, citations: List[dict]) -> dict
       def sync_citations(old_report: str, new_report: str, citations: List[dict])
   ```

2. 修改时的引用处理：
   - 提取新报告中使用的引用
   - 与原有引用列表对比
   - 标记失效的引用
   - 建议添加新引用

3. 引用验证：
   - 检查引用编号连续性
   - 验证引用格式一致性
   - 确保所有引用都被使用

**优点**：
- 保持引用准确性
- 自动检测引用问题
- 提高报告质量

**缺点**：
- 增加处理复杂度
- 可能需要额外的搜索

**实施优先级**：中 ⭐⭐（方案4）




### 短期改进（1-2 周内实施）

**优先级 P0（立即实施）**：
1. ✅ 提高 `max_step_num` 默认值：3 → 10
2. ✅ 优化 Reporter prompt，添加长度和深度要求
3. ✅ 在 `conf.yaml` 中推荐使用大上下文模型

**优先级 P1（2 周内）**：
1. 实施搜索内容混合清洗策略（规则 + 选择性摘要）
2. 在 Coordinator 中添加大纲检测逻辑

### 中期改进（1-2 个月内实施）

**优先级 P2**：
1. 修改 Planner 支持用户大纲模式
2. 实施分层报告生成机制
3. 优化 Context Manager 的压缩策略

### 长期改进（3+ 个月）

**优先级 P3**：
1. 动态步骤数量调整机制
2. 智能内容相关性验证
3. 多轮报告迭代优化

---

## 实施路线图

### 阶段 1：快速修复（第 1 周）

**目标**：立即改善用户体验

**任务清单**：
- [ ] 修改 `src/config/configuration.py`：`max_step_num: int = 10`
- [ ] 修改 `src/server/chat_request.py`：允许 `max_step_num` 最大 20
- [ ] 更新 `src/prompts/reporter.md`：添加长度要求（5000+ 字）
- [ ] 更新 `src/prompts/reporter.zh_CN.md`：添加长度要求
- [ ] 更新文档：推荐使用大上下文模型配置

**预期效果**：
- 报告长度提升 2-3 倍
- 支持更复杂的研究主题
- 无需代码重构

### 阶段 2：内容质量优化（第 2-3 周）

**目标**：减少 prompt 爆炸，提高内容质量

**任务清单**：
- [ ] 在 `src/tools/search_postprocessor.py` 中添加规则清洗
- [ ] 实现选择性内容摘要功能
- [ ] 添加配置参数到 `conf.yaml`
- [ ] 编写单元测试

**预期效果**：
- 减少 30-50% 的无关内容
- 降低 Context Manager 压缩频率
- 保留更多关键信息

### 阶段 3：用户大纲支持（第 4-6 周）

**目标**：支持用户自定义研究框架

**任务清单**：
- [ ] 修改 `src/graph/types.py`：添加大纲相关字段
- [ ] 修改 `src/prompts/coordinator.md`：添加大纲检测指令
- [ ] 修改 `src/graph/nodes.py`：实现大纲解析和转换
- [ ] 修改 `src/prompts/planner.md`：支持用户大纲模式
- [ ] 编写集成测试

**预期效果**：
- 完全遵循用户提供的研究框架
- 提高用户满意度
- 增强系统灵活性

---

## 总结

### 核心问题回顾

本文档分析了 DeerFlow 的三个主要架构缺陷：

1. **搜索内容缺乏审查** → 导致 prompt 爆炸和上下文压缩
2. **报告生成受限** → 内容简单、字数少
3. **大纲生成不灵活** → 无法使用用户自定义框架

### 关键改进方向

**立即可实施**（P0）：
- 提高 `max_step_num` 到 10
- 优化 Reporter prompt 添加长度要求
- 推荐大上下文模型配置

**短期优化**（P1）：
- 搜索内容混合清洗策略
- Coordinator 大纲检测

**中长期增强**（P2-P3）：
- Planner 用户大纲模式
- 分层报告生成
- 动态步骤调整

### 预期收益

实施这些改进后，预期可以达到：
- 报告长度：从 1000-3000 字提升到 5000-15000 字
- 内容质量：更深入的分析和更详细的论述
- 用户体验：支持自定义研究框架
- 系统效率：减少无效内容，降低 token 消耗

---

**文档维护者**: Claude Code
**最后更新**: 2026-02-10




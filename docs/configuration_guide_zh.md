# 配置指南

## 快速设置

将 `conf.yaml.example` 文件复制为 `conf.yaml`，并根据您的具体设置和需求修改配置。

```bash
cd deer-flow
cp conf.yaml.example conf.yaml
```

## DeerFlow 支持哪些模型？

在 DeerFlow 中，我们目前仅支持非推理模型。这意味着像 OpenAI 的 o1/o3 或 DeepSeek 的 R1 等模型暂不支持，但我们计划在未来添加对它们的支持。此外，由于缺乏工具调用能力，所有 Gemma-3 模型目前也不受支持。

### 支持的模型

`doubao-1.5-pro-32k-250115`、`gpt-4o`、`qwen-max-latest`、`qwen3-235b-a22b`、`qwen3-coder`、`gemini-2.0-flash`、`deepseek-v3`，以及理论上任何其他实现了 OpenAI API 规范的非推理聊天模型。

### 本地模型支持

DeerFlow 通过 OpenAI 兼容 API 支持本地模型：

- **Ollama**：`http://localhost:11434/v1`（已测试并支持本地开发）

详细配置示例请参阅 `conf.yaml.example` 文件。

> [!NOTE]
> 深度研究流程要求模型具有**较长的上下文窗口**，并非所有模型都支持此功能。
> 一种解决方法是在网页右上角的设置对话框中将 `研究计划的最大步骤数` 设置为 `2`，
> 或在调用 API 时将 `max_step_num` 设置为 `2`。

### 如何切换模型？
您可以通过修改项目根目录下的 `conf.yaml` 文件来切换使用的模型，使用 [litellm 格式](https://docs.litellm.ai/docs/providers/openai_compatible) 进行配置。

---

### 如何使用 OpenAI 兼容模型？

DeerFlow 支持与 OpenAI 兼容模型集成，即实现了 OpenAI API 规范的模型。这包括各种提供与 OpenAI 格式兼容的 API 端点的开源和商业模型。您可以参考 [litellm OpenAI-Compatible](https://docs.litellm.ai/docs/providers/openai_compatible) 获取详细文档。
以下是使用 OpenAI 兼容模型的 `conf.yaml` 配置示例：

```yaml
# 火山引擎提供的豆包模型示例
BASIC_MODEL:
  base_url: "https://ark.cn-beijing.volces.com/api/v3"
  model: "doubao-1.5-pro-32k-250115"
  api_key: YOUR_API_KEY

# 阿里云模型示例
BASIC_MODEL:
  base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  model: "qwen-max-latest"
  api_key: YOUR_API_KEY

# DeepSeek 官方模型示例
BASIC_MODEL:
  base_url: "https://api.deepseek.com"
  model: "deepseek-chat"
  api_key: YOUR_API_KEY

# 使用 OpenAI 兼容接口的 Google Gemini 模型示例
BASIC_MODEL:
  base_url: "https://generativelanguage.googleapis.com/v1beta/openai/"
  model: "gemini-2.0-flash"
  api_key: YOUR_API_KEY
```
以下是使用最佳开源 OpenAI 兼容模型的 `conf.yaml` 配置示例：
```yaml
# 使用最新的 deepseek-v3 处理基础任务，基础任务的开源 SOTA 模型
BASIC_MODEL:
  base_url: https://api.deepseek.com
  model: "deepseek-v3"
  api_key: YOUR_API_KEY
  temperature: 0.6
  top_p: 0.90
# 使用 qwen3-235b-a22b 处理推理任务，推理的开源 SOTA 模型
REASONING_MODEL:
  base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
  model: "qwen3-235b-a22b-thinking-2507"
  api_key: YOUR_API_KEY
  temperature: 0.6
  top_p: 0.90
# 使用 qwen3-coder-480b-a35b-instruct 处理编码任务，编码的开源 SOTA 模型
CODE_MODEL:
  base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
  model: "qwen3-coder-480b-a35b-instruct"
  api_key: YOUR_API_KEY
  temperature: 0.6
  top_p: 0.90
```
此外，您需要在 `src/config/agents.py` 中设置 `AGENT_LLM_MAP`，以便为每个代理使用正确的模型。例如：

```python
# 定义代理-LLM 映射
AGENT_LLM_MAP: dict[str, LLMType] = {
    "coordinator": "reasoning",
    "planner": "reasoning",
    "researcher": "reasoning",
    "coder": "basic",
    "reporter": "basic",
    "podcast_script_writer": "basic",
    "ppt_composer": "basic",
    "prose_writer": "basic",
    "prompt_enhancer": "basic",
}


### 如何使用 Google AI Studio 模型？

DeerFlow 支持与 Google AI Studio（原 Google Generative AI）API 的原生集成。这提供了对 Google Gemini 模型的直接访问，具有完整的功能集和优化的性能。

要使用 Google AI Studio 模型，您需要：
1. 从 [Google AI Studio](https://aistudio.google.com/app/apikey) 获取您的 API 密钥
2. 在配置中将 `platform` 字段设置为 `"google_aistudio"`
3. 配置您的模型和 API 密钥

以下是使用 Google AI Studio 模型的配置示例：

```yaml
# Google AI Studio 原生 API（推荐用于 Google 模型）
BASIC_MODEL:
  platform: "google_aistudio"
  model: "gemini-2.5-flash"  # 或 "gemini-1.5-pro" 等
  api_key: YOUR_GOOGLE_API_KEY # 从 https://aistudio.google.com/app/apikey 获取
```

**注意：** `platform: "google_aistudio"` 字段是必需的，用于区分其他可能通过 OpenAI 兼容 API 提供 Gemini 模型的提供商。
```

### 如何使用自签名 SSL 证书的模型？

如果您的 LLM 服务器使用自签名 SSL 证书，您可以通过在模型配置中添加 `verify_ssl: false` 参数来禁用 SSL 证书验证：

```yaml
BASIC_MODEL:
  base_url: "https://your-llm-server.com/api/v1"
  model: "your-model-name"
  api_key: YOUR_API_KEY
  verify_ssl: false  # 为自签名证书禁用 SSL 证书验证
```

> [!WARNING]
> 禁用 SSL 证书验证会降低安全性，仅应在开发环境中或当您信任 LLM 服务器时使用。在生产环境中，建议使用正规签发的 SSL 证书。

### 如何使用 Ollama 模型？

DeerFlow 支持集成 Ollama 模型。您可以参考 [litellm Ollama](https://docs.litellm.ai/docs/providers/ollama)。<br>
以下是使用 Ollama 模型的 `conf.yaml` 配置示例（您可能需要先运行 'ollama serve'）：

```yaml
BASIC_MODEL:
  model: "model-name"  # 模型名称，需支持 completions API（重要），例如：qwen3:8b、mistral-small3.1:24b、qwen2.5:3b
  base_url: "http://localhost:11434/v1" # Ollama 的本地服务地址，可通过 ollama serve 启动/查看
  api_key: "whatever"  # 必填，使用任意随机字符串作为假 api_key :-)
```

### 如何使用 OpenRouter 模型？

DeerFlow 支持集成 OpenRouter 模型。您可以参考 [litellm OpenRouter](https://docs.litellm.ai/docs/providers/openrouter)。要使用 OpenRouter 模型，您需要：
1. 从 OpenRouter (https://openrouter.ai/) 获取 OPENROUTER_API_KEY 并设置到环境变量中。
2. 在模型名称前添加 `openrouter/` 前缀。
3. 配置正确的 OpenRouter base URL。

以下是使用 OpenRouter 模型的配置示例：
1. 在环境变量中配置 OPENROUTER_API_KEY（如 `.env` 文件）
```ini
OPENROUTER_API_KEY=""
```
2. 在 `conf.yaml` 中设置模型名称
```yaml
BASIC_MODEL:
  model: "openrouter/google/palm-2-chat-bison"
```

注意：可用的模型及其确切名称可能会随时间变化。请在 [OpenRouter 官方文档](https://openrouter.ai/docs) 中验证当前可用的模型及其正确标识符。


### 如何使用 Azure OpenAI 聊天模型？

DeerFlow 支持集成 Azure OpenAI 聊天模型。您可以参考 [AzureChatOpenAI](https://python.langchain.com/api_reference/openai/chat_models/langchain_openai.chat_models.azure.AzureChatOpenAI.html)。`conf.yaml` 配置示例：
```yaml
BASIC_MODEL:
  model: "azure/gpt-4o-2024-08-06"
  azure_endpoint: $AZURE_OPENAI_ENDPOINT
  api_version: $OPENAI_API_VERSION
  api_key: $AZURE_OPENAI_API_KEY
```

### 如何为不同模型配置上下文长度

不同模型有不同的上下文长度限制。DeerFlow 提供了一种方法来控制不同模型之间的上下文长度。您可以在 `conf.yaml` 文件中配置不同模型的上下文长度。例如：
```yaml
BASIC_MODEL:
  base_url: https://ark.cn-beijing.volces.com/api/v3
  model: "doubao-1-5-pro-32k-250115"
  api_key: ""
  token_limit: 128000
```
这意味着使用该模型的上下文长度限制为 128k。

如果未设置 token_limit，上下文管理将不会生效。

## 关于搜索引擎

### 支持的搜索引擎
DeerFlow 支持以下搜索引擎：
- Tavily
- InfoQuest
- DuckDuckGo
- Brave Search
- Arxiv
- Searx
- Serper
- Wikipedia

### 如何使用 Serper 搜索？

要使用 Serper 作为您的搜索引擎，您需要：
1. 从 [Serper](https://serper.dev/) 获取您的 API 密钥
2. 在 `.env` 文件中设置 `SEARCH_API=serper`
3. 在 `.env` 文件中设置 `SERPER_API_KEY=your_api_key`

### 如何控制 Tavily 的搜索域名？

DeerFlow 允许您通过配置文件控制 Tavily 搜索结果中包含或排除哪些域名。这有助于通过聚焦可信来源来提高搜索结果质量并减少幻觉。

`提示`：目前仅支持 Tavily。

您可以在 `conf.yaml` 文件中按如下方式配置域名过滤和搜索结果：

```yaml
SEARCH_ENGINE:
  engine: tavily
  # 仅包含来自这些域名的结果（白名单）
  include_domains:
    - trusted-news.com
    - gov.org
    - reliable-source.edu
  # 排除来自这些域名的结果（黑名单）
  exclude_domains:
    - unreliable-site.com
    - spam-domain.net
  # 在搜索结果中包含图片，默认：true
  include_images: false
  # 在搜索结果中包含图片描述，默认：true
  include_image_descriptions: false
  # 在搜索结果中包含原始内容，默认：true
  include_raw_content: false
```

### 如何后处理 Tavily 搜索结果

DeerFlow 可以对 Tavily 搜索结果进行后处理：
* 去除重复内容
* 过滤低质量内容：过滤掉相关性评分较低的结果
* 清除 base64 编码的图片
* 长度截断：根据用户配置的长度截断每条搜索结果

低质量内容过滤和长度截断取决于用户配置，提供两个可配置参数：
* min_score_threshold：最低相关性评分阈值，低于此阈值的搜索结果将被过滤。如果未设置，则不进行过滤；
* max_content_length_per_page：每条搜索结果内容的最大长度限制，超过此长度的部分将被截断。如果未设置，则不进行截断；

这两个参数可以在 `conf.yaml` 中按如下方式配置：
```yaml
SEARCH_ENGINE:
  engine: tavily
  include_images: true
  min_score_threshold: 0.4
  max_content_length_per_page: 5000
```
这意味着搜索结果将根据最低相关性评分阈值进行过滤，并根据每条搜索结果内容的最大长度限制进行截断。

## 网络搜索开关

DeerFlow 允许您禁用网络搜索功能，这在没有互联网访问的环境中或当您只想使用本地 RAG 知识库时非常有用。

### 配置

您可以在 `conf.yaml` 文件中禁用网络搜索：

```yaml
# 禁用网络搜索（仅使用本地 RAG）
ENABLE_WEB_SEARCH: false
```

或通过 API 请求参数：

```json
{
  "messages": [{"role": "user", "content": "研究主题"}],
  "enable_web_search": false
}
```

> [!WARNING]
> 如果您禁用了网络搜索，请确保配置了本地 RAG 资源；否则，研究员将在纯 LLM 推理模式下运行，没有外部数据源。

### 禁用网络搜索时的行为

- **背景调查**：完全跳过（依赖网络搜索）
- **研究员节点**：如果已配置，将仅使用 RAG 检索工具
- **纯推理模式**：如果没有可用的 RAG 资源，研究员将仅依赖 LLM 推理

---

## 递归回退配置

当代理达到递归限制时，DeerFlow 可以优雅地生成已积累发现的摘要，而不是直接失败（默认启用）。

### 配置

在 `conf.yaml` 中：
```yaml
ENABLE_RECURSION_FALLBACK: true
```

### 递归限制

通过环境变量设置最大递归限制：
```bash
export AGENT_RECURSION_LIMIT=50  # 默认值：25
```

或在 `.env` 中：
```ini
AGENT_RECURSION_LIMIT=50
```

---

## RAG（检索增强生成）配置

DeerFlow 支持多种 RAG 提供商用于文档检索。通过设置环境变量来配置 RAG 提供商。

### 支持的 RAG 提供商

- **RAGFlow**：使用 RAGFlow API 进行文档检索
- **VikingDB 知识库**：字节跳动的 VikingDB 知识库服务
- **Milvus**：用于相似性搜索的开源向量数据库
- **Qdrant**：开源向量搜索引擎，支持云端和自托管选项
- **MOI**：面向企业用户的混合数据库
- **Dify**：具有 RAG 功能的 AI 应用平台

### Qdrant 配置

要使用 Qdrant 作为您的 RAG 提供商，请设置以下环境变量：

```bash
# RAG_PROVIDER: qdrant（使用 Qdrant Cloud 或自托管）
RAG_PROVIDER=qdrant
QDRANT_LOCATION=https://xyz-example.eu-central.aws.cloud.qdrant.io:6333
QDRANT_API_KEY=<your_qdrant_api_key>
QDRANT_COLLECTION=documents
QDRANT_EMBEDDING_PROVIDER=openai  # 支持 openai、dashscope
QDRANT_EMBEDDING_BASE_URL=
QDRANT_EMBEDDING_MODEL=text-embedding-ada-002
QDRANT_EMBEDDING_API_KEY=<your_embedding_api_key>
QDRANT_AUTO_LOAD_EXAMPLES=true  # 自动加载示例 markdown 文件
```

### Milvus 配置

要使用 Milvus 作为您的 RAG 提供商，请设置以下环境变量：

```bash
# RAG_PROVIDER: milvus（使用 Zilliz Cloud 上的免费 milvus 实例：https://docs.zilliz.com/docs/quick-start）
RAG_PROVIDER=milvus
MILVUS_URI=<endpoint_of_self_hosted_milvus_or_zilliz_cloud>
MILVUS_USER=<username_of_self_hosted_milvus_or_zilliz_cloud>
MILVUS_PASSWORD=<password_of_self_hosted_milvus_or_zilliz_cloud>
MILVUS_COLLECTION=documents
MILVUS_EMBEDDING_PROVIDER=openai
MILVUS_EMBEDDING_BASE_URL=
MILVUS_EMBEDDING_MODEL=
MILVUS_EMBEDDING_API_KEY=

# RAG_PROVIDER: milvus（在 Mac 或 Linux 上使用 milvus lite）
RAG_PROVIDER=milvus
MILVUS_URI=./milvus_demo.db
MILVUS_COLLECTION=documents
MILVUS_EMBEDDING_PROVIDER=openai
MILVUS_EMBEDDING_BASE_URL=
MILVUS_EMBEDDING_MODEL=
MILVUS_EMBEDDING_API_KEY=
```

---

## 多轮澄清（可选）

一个可选功能，通过对话帮助澄清模糊的研究问题。**默认禁用。**

### 通过命令行启用

```bash
# 为模糊问题启用澄清
uv run main.py "Research AI" --enable-clarification

# 设置自定义最大澄清轮数
uv run main.py "Research AI" --enable-clarification --max-clarification-rounds 3

# 带澄清的交互模式
uv run main.py --interactive --enable-clarification --max-clarification-rounds 3
```

### 通过 API 启用

```json
{
  "messages": [{"role": "user", "content": "Research AI"}],
  "enable_clarification": true,
  "max_clarification_rounds": 3
}
```

### 通过 UI 设置启用

1. 打开 DeerFlow 网页界面
2. 导航到 **设置** → **通用** 选项卡
3. 找到 **"启用澄清"** 开关
4. 将其打开以启用多轮澄清。澄清功能**默认禁用**。您需要通过上述任一方法手动启用它。启用澄清后，您将在开关下方看到 **"最大澄清轮数"** 字段
6. 设置最大澄清轮数（默认：3，最小：1）
7. 点击 **保存** 以应用更改

**启用后**，协调器将在开始研究之前针对模糊主题提出最多指定轮数的澄清问题，从而提高报告的相关性和深度。`max_clarification_rounds` 参数控制允许的澄清轮数。


**注意**：`max_clarification_rounds` 参数仅在 `enable_clarification` 设置为 `true` 时生效。如果澄清功能被禁用，此参数将被忽略。

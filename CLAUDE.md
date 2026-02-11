# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DeerFlow is a Deep Research framework that combines LLMs with specialized tools (web search, crawling, Python execution) using LangGraph for workflow orchestration. The system uses a multi-agent architecture where different agents collaborate to conduct research and generate comprehensive reports.

## Development Commands

### Setup and Installation

```bash
# Install Python dependencies (uv handles venv creation automatically)
uv sync

# Install development dependencies
uv pip install -e ".[dev]"
uv pip install -e ".[test]"

# Install frontend dependencies
cd web && pnpm install
```

### Running the Application

```bash
# Console UI (quickest way to test)
uv run main.py

# Web UI - Development mode (starts both backend and frontend)
./bootstrap.sh -d          # macOS/Linux
bootstrap.bat -d           # Windows

# Backend only
uv run server.py --host localhost --port 8000

# Backend with auto-reload
make serve
```

### Testing and Quality

```bash
# Run all tests
make test

# Run specific test file
uv run pytest tests/integration/test_workflow.py

# Run with coverage
make coverage

# Lint and fix code
make lint

# Format code
make format

# Lint frontend
make lint-frontend
```

### LangGraph Development

```bash
# Start LangGraph dev server with blocking operations allowed
make langgraph-dev
```

## Configuration Files

### Critical Configuration Files

1. **`.env`** - Environment variables (API keys, feature flags)
   - Copy from `.env.example` and configure
   - Controls: search engine, RAG provider, TTS, security flags
   - **Security**: `ENABLE_PYTHON_REPL` and `ENABLE_MCP_SERVER_CONFIGURATION` should be `false` in production

2. **`conf.yaml`** - LLM model configuration
   - Copy from `conf.yaml.example` and configure
   - Defines: BASIC_MODEL, REASONING_MODEL (optional), CODE_MODEL (optional)
   - Supports: OpenAI-compatible APIs, Google AI Studio, local models (Ollama)
   - See `docs/configuration_guide.md` for detailed model configuration

3. **`src/config/agents.py`** - Agent-to-LLM mapping
   - Maps each agent (coordinator, planner, researcher, etc.) to LLM type
   - Modify `AGENT_LLM_MAP` to use different models for different agents

## Architecture Overview

### Key Directories

```
src/
├── agents/          # Agent definitions and behaviors
├── config/          # Configuration management (YAML, env vars)
├── crawler/         # Web crawling and content extraction
├── graph/           # LangGraph workflow definitions
├── llms/            # LLM provider integrations (OpenAI, DeepSeek, etc.)
├── prompts/         # Agent prompt templates
├── server/          # FastAPI web server and endpoints
├── tools/           # External tools (search, TTS, Python REPL)
└── rag/             # RAG integration for private knowledgebases

web/                 # Next.js web UI (React, TypeScript)
├── src/app/         # Next.js pages and API routes
├── src/components/  # UI components and design system
└── src/core/        # Frontend utilities and state management
```

### LangGraph Workflow

DeerFlow uses LangGraph to orchestrate a multi-agent workflow. The main workflow is defined in `src/graph/builder.py`:

```
DeerFlow 使用 LangGraph 构建了一个多 Agent 协作的工作流：

用户输入
   ↓
coordinator（协调器）
   ↓
background_investigator（背景调查）
   ↓
planner（规划器）
   ↓
research_team（研究团队）
   ├→ researcher（研究员 - 网络搜索）
   ├→ analyst（分析师 - 数据分析）
   └→ coder（代码执行器 - Python 代码）
   ↓
reporter（报告生成器）
   ↓
最终报告输出
```

**Key Nodes:**
- **coordinator**: Entry point, handles clarification and language detection
- **background_investigator**: Optional pre-research web search (controlled by `enable_background_investigation`)
- **planner**: Creates research plan with steps (RESEARCH/ANALYSIS/PROCESSING)
- **research_team**: Dispatcher that routes to appropriate agent based on step type
- **researcher**: Executes web search steps
- **analyst**: Executes data analysis steps
- **coder**: Executes Python code for data processing
- **reporter**: Generates final report from all observations

### State Management

The workflow state is defined in `src/graph/types.py` as `State(MessagesState)`:

**Critical State Fields:**
- `messages`: LangChain message history
- `research_topic`: Original user query
- `clarified_research_topic`: Topic after clarification rounds
- `current_plan`: Current research plan (Plan object)
- `observations`: List of findings from each step
- `resources`: RAG resources used
- `citations`: Citation metadata collected during research
- `enable_clarification`: Whether to enable multi-turn clarification (default: False)
- `clarification_rounds`: Current clarification round counter
- `goto`: Next node to execute

### Core Module Structure

**`src/graph/`** - LangGraph workflow implementation
- `builder.py`: Graph construction and node routing logic
- `nodes.py`: All node implementations (coordinator, planner, researcher, etc.)
- `types.py`: State definition
- `checkpoint.py`: Checkpoint management for persistence
- `utils.py`: Helper functions for state manipulation

**`src/agents/`** - Agent creation and tool interception
- `agents.py`: Agent factory using LangChain's `create_react_agent`
- `tool_interceptor.py`: Intercepts tool calls for approval workflow

**`src/tools/`** - Tool implementations
- `search.py`: Web search integration (Tavily, InfoQuest, DuckDuckGo, etc.)
- `crawl.py`: Web crawling (Jina, InfoQuest)
- `python_repl.py`: Python code execution (sandboxed)
- `retriever.py`: RAG retrieval tool
- `tts.py`: Text-to-speech (Volcengine TTS)

**`src/llms/`** - LLM configuration and management
- `llm.py`: LLM factory, loads models from `conf.yaml`

**`src/server/`** - FastAPI backend
- `app.py`: Main FastAPI application with streaming endpoints
- `chat_request.py`: Request/response models
- `mcp_*.py`: MCP (Model Context Protocol) integration

**`src/rag/`** - RAG implementations
- `builder.py`: RAG retriever factory
- `milvus.py`, `qdrant.py`: Vector database integrations
- `ragflow.py`, `dify.py`: Third-party RAG service integrations

## Key Architectural Patterns

### Agent Creation Pattern

Agents are created using `src/agents/agents.py:create_agent()`:
- Uses LangChain's `create_react_agent` with custom prompts
- Tools are dynamically loaded based on configuration
- MCP tools can be injected via `config["configurable"]["mcp_settings"]`
- Tool interception is applied for sensitive operations

### Plan Execution Flow

1. **Planner** creates a `Plan` object with multiple `Step` objects (defined in `src/prompts/planner_model.py`)
2. Each `Step` has:
   - `step_type`: RESEARCH, ANALYSIS, or PROCESSING
   - `need_search`: Whether web search is needed
   - `execution_res`: Result after execution (initially None)
3. **research_team** node routes incomplete steps to appropriate agents
4. Agents execute and populate `execution_res`
5. Loop continues until all steps are complete
6. **Reporter** generates final report from all `observations`

### Checkpoint and Persistence

- Checkpoints are managed in `src/graph/checkpoint.py`
- Supports MongoDB (`AsyncMongoDBSaver`) and PostgreSQL (`AsyncPostgresSaver`)
- Configured via `LANGGRAPH_CHECKPOINT_SAVER` and `LANGGRAPH_CHECKPOINT_DB_URL` in `.env`
- Enables resuming interrupted workflows and multi-user sessions

### Context Management

- `src/utils/context_manager.py` handles token limit management
- Automatically compresses context when approaching model token limits
- Uses `token_limit` from `conf.yaml` to prevent overflow errors

## Important Implementation Details

### Tool Interrupts (Human-in-the-Loop)

Configured in `conf.yaml` under `TOOL_INTERRUPTS`:
- Allows pausing execution before sensitive tools are called
- User must approve with keywords: "approved", "yes", "proceed", "continue", "ok"
- Implemented in `src/agents/tool_interceptor.py`
- Can be overridden per-request via API

### Web Search Toggle

- Controlled by `ENABLE_WEB_SEARCH` in `conf.yaml` (default: true)
- When disabled, system relies only on local RAG knowledge base
- Can be overridden per-request via API parameter `enable_web_search`

### Clarification Feature

- Disabled by default (`enable_clarification=False` in State)
- When enabled, coordinator can ask follow-up questions before planning
- Controlled by `max_clarification_rounds` (default: 3)
- Logic in `src/graph/nodes.py:needs_clarification()`

### MCP (Model Context Protocol) Integration

- MCP servers can be configured in workflow config under `mcp_settings`
- Tools from MCP servers are dynamically loaded and added to agents
- See `docs/mcp_integrations.md` for details
- Security: `ENABLE_MCP_SERVER_CONFIGURATION` must be enabled in `.env`

## Working with the Codebase

### Adding a New Agent

1. Define agent in `src/config/agents.py` in `AGENT_LLM_MAP`
2. Create node function in `src/graph/nodes.py`
3. Add node to graph in `src/graph/builder.py`
4. Create prompt template in `src/prompts/template.py`

### Adding a New Tool

1. Create tool in `src/tools/` directory
2. Use `@tool` decorator from `langchain_core.tools`
3. Register in `src/tools/__init__.py`
4. Add to agent's tool list in node function

### Modifying the Workflow

- Main graph structure: `src/graph/builder.py`
- Node implementations: `src/graph/nodes.py`
- State fields: `src/graph/types.py`
- Use `Command` for node transitions with state updates
- Preserve meta fields using `preserve_state_meta_fields()` helper

### Debugging

- Set `DEBUG=true` in `.env` for detailed logging
- Use `LANGCHAIN_VERBOSE=true` and `LANGCHAIN_DEBUG=true` for LLM call traces
- Enable LangSmith tracing via `LANGSMITH_TRACING=true` in `.env`
- See `docs/DEBUGGING.md` for comprehensive debugging guide

## API Endpoints

The FastAPI backend (`src/server/app.py`) provides:

- `POST /api/chat` - Main chat endpoint with streaming support
- `POST /api/chat/podcast` - Generate podcast from report
- `POST /api/chat/ppt` - Generate PPT from report
- `POST /api/chat/prose` - Generate prose from report
- `POST /api/chat/enhance-prompt` - Enhance user prompt
- `GET /api/config` - Get system configuration
- `GET /api/rag/resources` - List RAG resources
- `POST /api/rag/resources` - Add RAG resource

See `docs/API.md` for detailed API documentation.

## Docker Deployment

```bash
# Build and run with docker-compose
docker-compose up -d

# Frontend: http://localhost:3000
# Backend: http://localhost:8000 (internal only)
```

## Code Style and Standards

- Python 3.12+ required
- Follow PEP 8 guidelines
- Use type hints where possible
- Run `make format` before committing
- Run `make lint` to check code quality
- Ensure tests pass with `make test`


# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is DeerFlow

DeerFlow is a full-stack AI super agent platform built on LangGraph and LangChain. It orchestrates a lead agent with sub-agents, sandboxed execution, persistent memory, and extensible tools/skills — all in per-thread isolated environments.

## Service Architecture

```
Browser → Nginx (2026) ─┬→ Frontend (3000)        # / (non-API)
                        ├→ Gateway API (8001)      # /api/* (models, mcp, skills, memory, uploads, artifacts)
                        └→ LangGraph Server (2024) # /api/langgraph/*
```

## Commands

### Full application (from project root)

```bash
make check          # Verify prerequisites (Node.js 22+, pnpm, uv, nginx)
make install        # Install all dependencies (frontend pnpm + backend uv)
make dev            # Start all services with nginx on localhost:2026
make stop           # Stop all services
make clean          # Stop + remove logs
```

### Docker development

```bash
make docker-init    # Build images, install deps (first time)
make docker-start   # Start all services (mode-aware from config.yaml)
make docker-stop    # Stop Docker services
make docker-logs    # View logs
```

### Backend (from backend/)

```bash
make dev            # LangGraph server only (port 2024)
make gateway        # Gateway API only (port 8001)
make test           # Run all tests: PYTHONPATH=. uv run pytest tests/ -v
make lint           # Lint with ruff
make format         # Format with ruff
```

Run a single test file:
```bash
cd backend && PYTHONPATH=. uv run pytest tests/test_<name>.py -v
```

### Frontend (from frontend/)

```bash
pnpm dev            # Dev server with Turbopack (port 3000)
pnpm build          # Production build
pnpm check          # Lint + typecheck (run before committing)
pnpm lint           # ESLint only
pnpm typecheck      # tsc --noEmit
```

No frontend test framework is configured.

## Configuration

Two config files live in the project root:

- `config.yaml` — Models, tools, sandbox, memory, skills, summarization, subagents. Copy from `config.example.yaml`. Values starting with `$` resolve as env vars.
- `extensions_config.json` — MCP servers and skill enabled states. Copy from `extensions_config.example.json`. Editable at runtime via Gateway API.

Config lookup order: explicit path → env var (`DEER_FLOW_CONFIG_PATH` / `DEER_FLOW_EXTENSIONS_CONFIG_PATH`) → current dir → parent dir.

## High-Level Architecture

### Backend (`backend/src/`)

- **`agents/lead_agent/`** — Main agent factory (`make_lead_agent`), registered in `langgraph.json`. Dynamic model selection, tool assembly, system prompt generation.
- **`deep_research/`** — Stable DeepResearch routing module (dedicated LangGraph workflow, quality gate, restricted tool filtering, and feature flag rollback via `DEER_FLOW_ENABLE_DEEP_RESEARCH_MIN_FLOW`).
- **`agents/middlewares/`** — 11 ordered middleware components that wrap the agent lifecycle (thread data, uploads, sandbox, dangling tool calls, summarization, todos, title, memory, view image, subagent limit, clarification). Order matters — see `backend/CLAUDE.md` for the full chain.
- **`agents/memory/`** — Persistent memory with LLM-based fact extraction, debounced queue, atomic file I/O. Stored in `backend/.deer-flow/memory.json`.
- **`gateway/`** — FastAPI app with routers for models, MCP, skills, memory, uploads, artifacts.
- **`sandbox/`** — Abstract sandbox interface with local and Docker providers. Virtual path system maps `/mnt/user-data/` and `/mnt/skills/` to host paths.
- **`subagents/`** — Task delegation with `general-purpose` and `bash` built-in agents. Dual thread pool, max 3 concurrent, 15-min timeout.
- **`tools/`** — Tool assembly from config, MCP, built-ins, community tools, and subagent tool.
- **`mcp/`** — Multi-server MCP client with lazy init and mtime-based cache invalidation.
- **`skills/`** — Markdown-based skill definitions with YAML frontmatter, loaded from `skills/{public,custom}/`.
- **`models/factory.py`** — Model instantiation via reflection, supports thinking and vision flags.
- **`config/`** — Typed config loading for app, model, sandbox, tool, etc.

### Frontend (`frontend/src/`)

- **`app/`** — Next.js App Router. Routes: `/` (landing), `/workspace/chats/[thread_id]` (chat).
- **`core/`** — Business logic: threads (streaming, state), API client singleton, artifacts, i18n, settings, memory, skills, MCP, messages.
- **`components/`** — `ui/` and `ai-elements/` are auto-generated (Shadcn, MagicUI, Vercel AI SDK) — don't manually edit. `workspace/` and `landing/` are app components.
- **Data flow**: User input → thread hooks → LangGraph SDK streaming → state updates → React rendering.
- **Tool routing**: Chat input tool selection can attach `task_type`, `tool_name`, and `tool_args` to submit payloads via LangGraph `context` for backend flow routing.

See `backend/CLAUDE.md` and `frontend/CLAUDE.md` for detailed sub-project guidance.

## Code Style

- **Backend**: Python 3.12+, `ruff` for linting/formatting, 240 char line length, double quotes
- **Frontend**: TypeScript 5.8, ESLint + Prettier, enforced import ordering (builtin → external → internal), `@/*` path alias maps to `src/*`, use `cn()` for conditional Tailwind classes, inline type imports (`import { type Foo }`)

## CI

GitHub Actions runs backend regression tests on every PR (`.github/workflows/backend-unit-tests.yml`):
- `tests/test_provisioner_kubeconfig.py`
- `tests/test_docker_sandbox_mode_detection.py`

## Documentation Update Policy

Update `README.md` and relevant `CLAUDE.md` files after code changes that affect architecture, commands, or workflows.

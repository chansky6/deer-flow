from types import SimpleNamespace

import src.tools as tools_module
from src.agents.lead_agent import agent as lead_agent_module
from src.config.app_config import AppConfig
from src.config.model_config import ModelConfig
from src.config.sandbox_config import SandboxConfig


def _make_app_config(models: list[ModelConfig]) -> AppConfig:
    return AppConfig(
        models=models,
        sandbox=SandboxConfig(use="src.sandbox.local:LocalSandboxProvider"),
    )


def _make_model(name: str, *, supports_thinking: bool) -> ModelConfig:
    return ModelConfig(
        name=name,
        display_name=name,
        description=None,
        use="langchain_openai:ChatOpenAI",
        model=name,
        supports_thinking=supports_thinking,
        supports_vision=False,
    )


def test_make_lead_agent_uses_deep_research_min_flow_when_enabled(monkeypatch):
    app_config = _make_app_config([_make_model("safe-model", supports_thinking=True)])
    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)
    monkeypatch.delenv("DEER_FLOW_ENABLE_DEEP_RESEARCH_MIN_FLOW", raising=False)

    captured_tool_kwargs: dict[str, object] = {}

    def _fake_get_available_tools(**kwargs):
        captured_tool_kwargs.update(kwargs)
        return [
            SimpleNamespace(name="web_search"),
            SimpleNamespace(name="present_files"),
            SimpleNamespace(name="bash"),
        ]

    monkeypatch.setattr(tools_module, "get_available_tools", _fake_get_available_tools)
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name: [])
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "BASE_PROMPT")
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    result = lead_agent_module.make_lead_agent(
        {
            "context": {
                "model_name": "safe-model",
                "thinking_enabled": True,
                "is_plan_mode": False,
                "subagent_enabled": True,
                "task_type": "deep_research",
                "tool_name": "deep_research",
            }
        }
    )

    assert captured_tool_kwargs["subagent_enabled"] is False
    assert [tool.name for tool in result["tools"]] == ["web_search", "present_files"]
    assert "<deep_research_min_flow version=\"v1\">" in result["system_prompt"]


def test_make_lead_agent_falls_back_when_deep_research_min_flow_disabled(monkeypatch):
    app_config = _make_app_config([_make_model("safe-model", supports_thinking=True)])
    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)
    monkeypatch.setenv("DEER_FLOW_ENABLE_DEEP_RESEARCH_MIN_FLOW", "false")

    captured_tool_kwargs: dict[str, object] = {}

    def _fake_get_available_tools(**kwargs):
        captured_tool_kwargs.update(kwargs)
        return [
            SimpleNamespace(name="web_search"),
            SimpleNamespace(name="present_files"),
            SimpleNamespace(name="bash"),
        ]

    monkeypatch.setattr(tools_module, "get_available_tools", _fake_get_available_tools)
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name: [])
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "BASE_PROMPT")
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    result = lead_agent_module.make_lead_agent(
        {
            "context": {
                "model_name": "safe-model",
                "thinking_enabled": True,
                "is_plan_mode": False,
                "subagent_enabled": True,
                "task_type": "deep_research",
                "tool_name": "deep_research",
            }
        }
    )

    assert captured_tool_kwargs["subagent_enabled"] is True
    assert [tool.name for tool in result["tools"]] == ["web_search", "present_files", "bash"]
    assert "<deep_research_min_flow version=\"v1\">" not in result["system_prompt"]


def test_runtime_options_prefer_context_over_configurable(monkeypatch):
    app_config = _make_app_config(
        [
            _make_model("context-model", supports_thinking=True),
            _make_model("config-model", supports_thinking=True),
        ]
    )
    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name: [])
    monkeypatch.setattr(lead_agent_module, "apply_prompt_template", lambda **kwargs: "BASE_PROMPT")
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    captured_model_kwargs: dict[str, object] = {}

    def _fake_create_chat_model(**kwargs):
        captured_model_kwargs.update(kwargs)
        return object()

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)

    lead_agent_module.make_lead_agent(
        {
            "configurable": {
                "model_name": "config-model",
                "thinking_enabled": True,
                "is_plan_mode": False,
                "subagent_enabled": False,
            },
            "context": {
                "model_name": "context-model",
            },
        }
    )

    assert captured_model_kwargs["name"] == "context-model"


"""Tests for the config management router.

Covers GET/PUT for each config.yaml section via the FastAPI test client.
Uses a temporary config file to avoid mutating the real config.
"""

import pytest
import yaml
from fastapi.testclient import TestClient

from src.config.app_config import reset_app_config
from src.gateway.app import create_app

SAMPLE_CONFIG = {
    "models": [
        {
            "name": "test-model",
            "display_name": "Test Model",
            "use": "langchain_openai:ChatOpenAI",
            "model": "gpt-4",
            "api_key": "$OPENAI_API_KEY",
        }
    ],
    "tools": [
        {"name": "web_search", "group": "web", "use": "src.community.tavily.tools:web_search_tool"}
    ],
    "tool_groups": [{"name": "web"}, {"name": "bash"}],
    "sandbox": {"use": "src.sandbox.local:LocalSandboxProvider"},
    "memory": {"enabled": True, "storage_path": ".deer-flow/memory.json", "debounce_seconds": 30},
    "title": {"enabled": True, "max_words": 6, "max_chars": 60},
    "summarization": {"enabled": True, "model_name": None},
    "subagents": {"timeout_seconds": 900},
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Create a test client with a temporary config.yaml."""
    config_file = tmp_path / "config.yaml"
    config_file.write_text(yaml.dump(SAMPLE_CONFIG, sort_keys=False))
    monkeypatch.setenv("DEER_FLOW_CONFIG_PATH", str(config_file))
    reset_app_config()
    app = create_app()
    yield TestClient(app)
    reset_app_config()


# ---------------------------------------------------------------------------
# GET endpoints
# ---------------------------------------------------------------------------


class TestGetEndpoints:
    def test_get_models(self, client):
        resp = client.get("/api/config/models")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "test-model"
        assert data[0]["api_key"] == "$OPENAI_API_KEY"

    def test_get_tools(self, client):
        resp = client.get("/api/config/tools")
        assert resp.status_code == 200
        assert resp.json()[0]["name"] == "web_search"

    def test_get_tool_groups(self, client):
        resp = client.get("/api/config/tool-groups")
        assert resp.status_code == 200
        names = [g["name"] for g in resp.json()]
        assert "web" in names
        assert "bash" in names

    def test_get_sandbox(self, client):
        resp = client.get("/api/config/sandbox")
        assert resp.status_code == 200
        assert resp.json()["use"] == "src.sandbox.local:LocalSandboxProvider"

    def test_get_memory(self, client):
        resp = client.get("/api/config/memory")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

    def test_get_title(self, client):
        resp = client.get("/api/config/title")
        assert resp.status_code == 200
        assert resp.json()["max_words"] == 6

    def test_get_summarization(self, client):
        resp = client.get("/api/config/summarization")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

    def test_get_subagents(self, client):
        resp = client.get("/api/config/subagents")
        assert resp.status_code == 200
        assert resp.json()["timeout_seconds"] == 900


# ---------------------------------------------------------------------------
# PUT endpoints
# ---------------------------------------------------------------------------


class TestPutEndpoints:
    def test_put_models(self, client):
        new_models = [{"name": "new-model", "use": "langchain_openai:ChatOpenAI", "model": "gpt-4o"}]
        resp = client.put("/api/config/models", json=new_models)
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        # Verify persisted
        resp2 = client.get("/api/config/models")
        assert resp2.json()[0]["name"] == "new-model"

    def test_put_tools(self, client):
        new_tools = [{"name": "new_tool", "group": "web", "use": "some.module:tool"}]
        resp = client.put("/api/config/tools", json=new_tools)
        assert resp.status_code == 200
        resp2 = client.get("/api/config/tools")
        assert resp2.json()[0]["name"] == "new_tool"

    def test_put_tool_groups(self, client):
        resp = client.put("/api/config/tool-groups", json=[{"name": "custom"}])
        assert resp.status_code == 200
        resp2 = client.get("/api/config/tool-groups")
        assert len(resp2.json()) == 1
        assert resp2.json()[0]["name"] == "custom"

    def test_put_sandbox(self, client):
        new_sandbox = {"use": "src.community.aio_sandbox:AioSandboxProvider", "port": 9090}
        resp = client.put("/api/config/sandbox", json=new_sandbox)
        assert resp.status_code == 200
        resp2 = client.get("/api/config/sandbox")
        assert resp2.json()["port"] == 9090

    def test_put_memory(self, client):
        new_memory = {"enabled": False, "storage_path": "/tmp/mem.json", "debounce_seconds": 60}
        resp = client.put("/api/config/memory", json=new_memory)
        assert resp.status_code == 200
        resp2 = client.get("/api/config/memory")
        assert resp2.json()["enabled"] is False
        assert resp2.json()["debounce_seconds"] == 60

    def test_put_title(self, client):
        resp = client.put("/api/config/title", json={"enabled": False, "max_words": 10, "max_chars": 80})
        assert resp.status_code == 200
        resp2 = client.get("/api/config/title")
        assert resp2.json()["max_words"] == 10

    def test_put_summarization(self, client):
        resp = client.put("/api/config/summarization", json={"enabled": False})
        assert resp.status_code == 200
        resp2 = client.get("/api/config/summarization")
        assert resp2.json()["enabled"] is False

    def test_put_subagents(self, client):
        resp = client.put("/api/config/subagents", json={"timeout_seconds": 1800})
        assert resp.status_code == 200
        resp2 = client.get("/api/config/subagents")
        assert resp2.json()["timeout_seconds"] == 1800

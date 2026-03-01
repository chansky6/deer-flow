from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage

from src.deep_research import workflow as workflow_module

VALID_REPORT = """
## Scope
Test scope
## Method
Test method
## Findings
- Claim A with citation [citation:A](https://a.example.com)
- Claim B with citation [citation:B](https://b.example.com)
## Risks and Uncertainties
Test risks
## References
- [citation:A](https://a.example.com) | category: official
- [citation:B](https://b.example.com) | category: media
""".strip()


def test_quality_check_report_passes_with_citations_and_category_diversity():
    passed, feedback = workflow_module._quality_check_report(VALID_REPORT)
    assert passed is True
    assert feedback == "quality gate passed"


def test_quality_check_report_fails_when_claim_missing_citation():
    invalid_report = """
## Scope
Test scope
## Method
Test method
## Findings
- Claim A without citation
## Risks and Uncertainties
Test risks
## References
- [citation:A](https://a.example.com) | category: official
- [citation:B](https://b.example.com) | category: media
""".strip()

    passed, feedback = workflow_module._quality_check_report(invalid_report)
    assert passed is False
    assert "uncited key claim" in feedback


def test_workflow_retries_once_when_quality_gate_fails(monkeypatch):
    retrieval_calls = {"count": 0}

    class FakeRetrievalAgent:
        def invoke(self, input_state, config=None, context=None):
            retrieval_calls["count"] += 1
            return {
                "messages": [
                    AIMessage(
                        content=(
                            "## Retrieval Log\n"
                            "round done\n\n"
                            "## Evidence Records\n"
                            "- claim: c1\n"
                            "  evidence: e1\n"
                            "  citation: [citation:A](https://a.example.com)\n"
                            "  category: official\n"
                        )
                    )
                ]
            }

    class FakeModel:
        def __init__(self):
            self.report_calls = 0

        def invoke(self, messages):
            prompt = messages[-1].content
            if "planning stage" in prompt:
                return AIMessage(content="plan")
            if "synthesis stage" in prompt:
                return AIMessage(content="synthesis [citation:A](https://a.example.com)")
            if "final report stage" in prompt:
                self.report_calls += 1
                if self.report_calls == 1:
                    # Fail quality gate: uncited finding + single category
                    return AIMessage(
                        content=(
                            "## Scope\nx\n"
                            "## Method\ny\n"
                            "## Findings\n"
                            "- uncited finding\n"
                            "## Risks and Uncertainties\nz\n"
                            "## References\n"
                            "- [citation:A](https://a.example.com) | category: official\n"
                        )
                    )
                return AIMessage(content=VALID_REPORT)
            return AIMessage(content="fallback")

    fake_model = FakeModel()
    monkeypatch.setattr(workflow_module, "create_chat_model", lambda **kwargs: fake_model)
    monkeypatch.setattr(workflow_module, "create_agent", lambda **kwargs: FakeRetrievalAgent())

    workflow = workflow_module.make_deep_research_workflow(
        model_name="fake-model",
        thinking_enabled=False,
        tools=[],
    )
    result = workflow.invoke({"messages": [HumanMessage(content="test question")]})

    assert retrieval_calls["count"] == 2
    final_message = result["messages"][-1]
    assert isinstance(final_message, AIMessage)
    assert "## References" in str(final_message.content)


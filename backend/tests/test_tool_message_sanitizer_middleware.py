from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from src.agents.middlewares.tool_message_sanitizer_middleware import ToolMessageSanitizerMiddleware


def test_drops_tool_message_without_prior_tool_calls():
    middleware = ToolMessageSanitizerMiddleware()
    messages = [
        AIMessage(content="Draft framework."),
        ToolMessage(content="Framework review requested.", tool_call_id="tc-1", name="request_framework_review"),
    ]

    filtered = middleware._filter_messages(messages)

    assert filtered is not None
    assert len(filtered) == 1
    assert isinstance(filtered[0], AIMessage)


def test_keeps_valid_tool_message_block():
    middleware = ToolMessageSanitizerMiddleware()
    messages = [
        AIMessage(content="", tool_calls=[{"name": "start_framework_review_draft", "id": "tc-1", "args": {}}]),
        ToolMessage(content="Started.", tool_call_id="tc-1", name="start_framework_review_draft"),
        AIMessage(content="Next step."),
    ]

    filtered = middleware._filter_messages(messages)

    assert filtered is None


def test_drops_tool_message_after_non_tool_message():
    middleware = ToolMessageSanitizerMiddleware()
    messages = [
        AIMessage(content="", tool_calls=[{"name": "search", "id": "tc-1", "args": {}}]),
        HumanMessage(content="Intervening message."),
        ToolMessage(content="Result", tool_call_id="tc-1", name="search"),
    ]

    filtered = middleware._filter_messages(messages)

    assert filtered is not None
    assert len(filtered) == 2
    assert isinstance(filtered[0], AIMessage)
    assert isinstance(filtered[1], HumanMessage)

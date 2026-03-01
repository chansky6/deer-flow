import logging
import re
from typing import NotRequired

from langchain.agents import AgentState, create_agent
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langchain.tools import BaseTool
from langgraph.graph import END, START, StateGraph

from src.models import create_chat_model

logger = logging.getLogger(__name__)

MAX_QUALITY_RETRY = 1

PLAN_PROMPT_TEMPLATE = """
You are running a deterministic deep-research planning stage.

User question:
{query}

Produce a concise research plan in markdown with:
1) Scope and constraints
2) 4-8 key sub-questions
3) Evidence targets for each sub-question
4) A source coverage checklist (official/academic/industry/media)
""".strip()

RETRIEVAL_SYSTEM_PROMPT = """
You are in the retrieval stage of a deep-research workflow.

Execution rules:
- Prioritize authoritative and recent sources.
- Use multiple search rounds; do not stop after one query.
- Capture evidence as verifiable records.

Output requirements:
- Return markdown sections:
  - ## Retrieval Log
  - ## Evidence Records
- In Evidence Records, each item must include:
  - claim:
  - evidence:
  - citation: [citation:TITLE](URL)
  - category: official|academic|industry|media|other
""".strip()

SYNTHESIS_PROMPT_TEMPLATE = """
You are in the synthesis stage of a deep-research workflow.

Question:
{query}

Research plan:
{plan}

Retrieved evidence:
{retrieval}

Create a structured synthesis in markdown:
- ## Evidence Map
- ## Cross-Source Validation
- ## Draft Findings

For each draft finding, include at least one inline citation in format [citation:TITLE](URL).
""".strip()

REPORT_PROMPT_TEMPLATE = """
You are in the final report stage of a deep-research workflow.

Question:
{query}

Research plan:
{plan}

Retrieved evidence:
{retrieval}

Synthesis:
{synthesis}

Return a final markdown report using EXACT section order:
## Scope
## Method
## Findings
## Risks and Uncertainties
## References

Requirements:
- Every key claim in Findings must include at least one inline citation: [citation:TITLE](URL).
- References must include categories using format:
  - [citation:TITLE](URL) | category: official|academic|industry|media|other
""".strip()

REVISION_HINT_TEMPLATE = """
Quality gate failed in previous attempt:
{quality_feedback}

Revise retrieval with stronger evidence coverage and citation completeness.
""".strip()

CLAIM_LINE_PATTERN = re.compile(r"^\s*(?:[-*]|\d+\.)\s+.+$", re.MULTILINE)
CITATION_PATTERN = re.compile(r"\[citation:[^\]]+\]\((https?://[^\s)]+)\)")
CATEGORY_PATTERN = re.compile(r"\|\s*category:\s*([a-zA-Z_]+)", re.IGNORECASE)


class DeepResearchState(AgentState):
    deep_research_query: NotRequired[str]
    deep_research_plan: NotRequired[str]
    deep_research_retrieval: NotRequired[str]
    deep_research_synthesis: NotRequired[str]
    deep_research_report: NotRequired[str]
    deep_research_quality_passed: NotRequired[bool]
    deep_research_quality_feedback: NotRequired[str]
    deep_research_retry_count: NotRequired[int]


def _extract_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, str):
                chunks.append(item)
            elif isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        return "\n".join(chunks).strip()
    return str(content)


def _latest_user_query(messages: list[BaseMessage]) -> str:
    for msg in reversed(messages):
        if getattr(msg, "type", None) == "human":
            return _extract_text(getattr(msg, "content", ""))
    return ""


def _extract_last_ai_text(messages: list[BaseMessage]) -> str:
    for msg in reversed(messages):
        if getattr(msg, "type", None) == "ai":
            return _extract_text(getattr(msg, "content", ""))
    return ""


def _extract_section(text: str, heading: str, next_headings: list[str]) -> str:
    start_idx = text.find(heading)
    if start_idx == -1:
        return ""
    start_idx += len(heading)

    end_idx = len(text)
    for next_heading in next_headings:
        idx = text.find(next_heading, start_idx)
        if idx != -1 and idx < end_idx:
            end_idx = idx
    return text[start_idx:end_idx].strip()


def _quality_check_report(report_markdown: str) -> tuple[bool, str]:
    findings_section = _extract_section(
        report_markdown,
        "## Findings",
        ["## Risks and Uncertainties", "## References"],
    )
    references_section = _extract_section(
        report_markdown,
        "## References",
        [],
    )

    claim_lines = CLAIM_LINE_PATTERN.findall(findings_section)
    missing_citation_count = 0
    for line in claim_lines:
        if not CITATION_PATTERN.search(line):
            missing_citation_count += 1

    # Fallback when model outputs paragraph findings instead of bullets.
    if not claim_lines and findings_section and not CITATION_PATTERN.search(findings_section):
        missing_citation_count = 1

    categories = {match.group(1).lower() for match in CATEGORY_PATTERN.finditer(references_section)}
    has_category_diversity = len(categories) >= 2

    issues: list[str] = []
    if missing_citation_count > 0:
        issues.append(f"findings contain {missing_citation_count} uncited key claim(s)")
    if not has_category_diversity:
        issues.append("references contain fewer than 2 source categories")

    if issues:
        return False, "; ".join(issues)
    return True, "quality gate passed"


def _build_deep_research_graph(
    *,
    model_name: str,
    thinking_enabled: bool,
    tools: list[BaseTool],
) -> StateGraph:
    model = create_chat_model(name=model_name, thinking_enabled=thinking_enabled)
    retrieval_agent = create_agent(
        model=create_chat_model(name=model_name, thinking_enabled=thinking_enabled),
        tools=tools,
        system_prompt=RETRIEVAL_SYSTEM_PROMPT,
        state_schema=AgentState,
    )

    def plan_node(state: DeepResearchState, config: RunnableConfig) -> dict:
        query = state.get("deep_research_query") or _latest_user_query(state.get("messages", []))
        prompt = PLAN_PROMPT_TEMPLATE.format(query=query)
        response = model.invoke([HumanMessage(content=prompt)])
        plan = _extract_text(getattr(response, "content", ""))
        return {
            "deep_research_query": query,
            "deep_research_plan": plan,
        }

    def retrieve_node(state: DeepResearchState, config: RunnableConfig) -> dict:
        query = state.get("deep_research_query") or _latest_user_query(state.get("messages", []))
        plan = state.get("deep_research_plan", "")
        quality_feedback = state.get("deep_research_quality_feedback", "")

        retrieval_prompt = f"Question:\n{query}\n\nPlan:\n{plan}\n"
        if quality_feedback:
            retrieval_prompt += "\n" + REVISION_HINT_TEMPLATE.format(quality_feedback=quality_feedback)

        run_config: RunnableConfig = {
            "recursion_limit": 80,
        }
        runtime_context: dict[str, str] = {}
        context = config.get("context", {})
        if isinstance(context, dict):
            thread_id = context.get("thread_id")
            if isinstance(thread_id, str) and thread_id:
                runtime_context["thread_id"] = thread_id

        result = retrieval_agent.invoke(
            {"messages": [HumanMessage(content=retrieval_prompt)]},
            config=run_config,
            context=runtime_context,
        )
        retrieval = _extract_last_ai_text(result.get("messages", []))
        return {
            "deep_research_retrieval": retrieval,
        }

    def synthesize_node(state: DeepResearchState, config: RunnableConfig) -> dict:
        query = state.get("deep_research_query", "")
        plan = state.get("deep_research_plan", "")
        retrieval = state.get("deep_research_retrieval", "")
        prompt = SYNTHESIS_PROMPT_TEMPLATE.format(
            query=query,
            plan=plan,
            retrieval=retrieval,
        )
        response = model.invoke([HumanMessage(content=prompt)])
        synthesis = _extract_text(getattr(response, "content", ""))
        return {
            "deep_research_synthesis": synthesis,
        }

    def report_node(state: DeepResearchState, config: RunnableConfig) -> dict:
        query = state.get("deep_research_query", "")
        plan = state.get("deep_research_plan", "")
        retrieval = state.get("deep_research_retrieval", "")
        synthesis = state.get("deep_research_synthesis", "")
        prompt = REPORT_PROMPT_TEMPLATE.format(
            query=query,
            plan=plan,
            retrieval=retrieval,
            synthesis=synthesis,
        )
        response = model.invoke([HumanMessage(content=prompt)])
        report = _extract_text(getattr(response, "content", ""))
        quality_passed, quality_feedback = _quality_check_report(report)

        retry_count = state.get("deep_research_retry_count", 0)
        if not quality_passed:
            retry_count += 1

        return {
            "deep_research_report": report,
            "deep_research_quality_passed": quality_passed,
            "deep_research_quality_feedback": quality_feedback,
            "deep_research_retry_count": retry_count,
        }

    def finalize_node(state: DeepResearchState, config: RunnableConfig) -> dict:
        report = state.get("deep_research_report", "")
        quality_passed = state.get("deep_research_quality_passed", False)
        quality_feedback = state.get("deep_research_quality_feedback", "")

        final_report = report
        if not quality_passed and quality_feedback:
            final_report = (
                f"{report}\n\n"
                "## Quality Check Note\n"
                f"- Auto quality gate did not fully pass after retry: {quality_feedback}\n"
            )

        return {
            "messages": [AIMessage(content=final_report)],
        }

    def route_after_report(state: DeepResearchState) -> str:
        quality_passed = state.get("deep_research_quality_passed", False)
        retry_count = state.get("deep_research_retry_count", 0)
        if quality_passed or retry_count > MAX_QUALITY_RETRY:
            return "finalize"
        return "retrieve"

    builder = StateGraph(DeepResearchState)
    builder.add_node("plan", plan_node)
    builder.add_node("retrieve", retrieve_node)
    builder.add_node("synthesize", synthesize_node)
    builder.add_node("report", report_node)
    builder.add_node("finalize", finalize_node)

    builder.add_edge(START, "plan")
    builder.add_edge("plan", "retrieve")
    builder.add_edge("retrieve", "synthesize")
    builder.add_edge("synthesize", "report")
    builder.add_conditional_edges("report", route_after_report, ["retrieve", "finalize"])
    builder.add_edge("finalize", END)
    return builder


def make_deep_research_workflow(
    *,
    model_name: str,
    thinking_enabled: bool,
    tools: list[BaseTool],
):
    """Build a stable deep-research LangGraph workflow.

    The workflow uses fixed stages (plan/retrieve/synthesize/report) and a
    programmatic quality gate to reduce output variance.
    """
    graph = _build_deep_research_graph(
        model_name=model_name,
        thinking_enabled=thinking_enabled,
        tools=tools,
    )
    return graph.compile()

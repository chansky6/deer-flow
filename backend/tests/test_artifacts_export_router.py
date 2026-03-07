from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config import paths as paths_module
from src.gateway import markdown_export
from src.gateway.routers import artifacts


pytest.importorskip("docx")
pytest.importorskip("reportlab")

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(paths_module, "_paths", paths_module.Paths(base_dir=tmp_path / ".deer-flow"))
    app = FastAPI()
    app.include_router(artifacts.router)
    yield TestClient(app), tmp_path / ".deer-flow"
    monkeypatch.setattr(paths_module, "_paths", None)


def _write_thread_artifact(base_dir, thread_id: str, filename: str, content: str) -> None:
    outputs_dir = base_dir / "threads" / thread_id / "user-data" / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    (outputs_dir / filename).write_text(content, encoding="utf-8")


def test_export_markdown_artifact_as_pdf(client):
    test_client, base_dir = client
    _write_thread_artifact(
        base_dir,
        "thread-1",
        "report.md",
        "# Report title\n\nA paragraph with **bold** text.\n\n- Item one\n- Item two\n\n```python\nprint('ok')\n```\n\n| Name | Value |\n| --- | --- |\n| DeerFlow | Export |\n",
    )

    response = test_client.get("/api/threads/thread-1/artifacts/export/mnt/user-data/outputs/report.md?format=pdf")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "report.pdf" in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF")


def test_export_markdown_artifact_as_docx(client):
    test_client, base_dir = client
    _write_thread_artifact(
        base_dir,
        "thread-2",
        "report.md",
        "# Report title\n\n> Blockquote\n\n1. First\n2. Second\n",
    )

    response = test_client.get("/api/threads/thread-2/artifacts/export/mnt/user-data/outputs/report.md?format=docx")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert "report.docx" in response.headers["content-disposition"]

    archive = ZipFile(BytesIO(response.content))
    assert "word/document.xml" in archive.namelist()
    xml = archive.read("word/document.xml").decode("utf-8")
    assert "Report title" in xml


def test_export_rejects_non_markdown_artifacts(client):
    test_client, base_dir = client
    _write_thread_artifact(base_dir, "thread-3", "report.txt", "plain text")

    response = test_client.get("/api/threads/thread-3/artifacts/export/mnt/user-data/outputs/report.txt?format=pdf")

    assert response.status_code == 400
    assert response.json()["detail"] == "Only Markdown artifacts can be exported"


def test_export_returns_404_for_missing_artifact(client):
    test_client, _ = client

    response = test_client.get("/api/threads/thread-4/artifacts/export/mnt/user-data/outputs/missing.md?format=pdf")

    assert response.status_code == 404


def test_export_rejects_invalid_virtual_path(client):
    test_client, _ = client

    response = test_client.get("/api/threads/thread-5/artifacts/export/not-a-virtual-path/report.md?format=pdf")

    assert response.status_code == 400


def test_export_markdown_artifact_as_pdf_uses_panel_sans_fonts_for_english_text(client, monkeypatch):
    markdown_export._resolve_pdf_latin_font_names.cache_clear()
    monkeypatch.setattr(
        markdown_export,
        "_discover_pdf_panel_font_paths",
        lambda: {
            "regular": Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            "bold": Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            "italic": None,
            "bold_italic": None,
        },
    )

    test_client, base_dir = client
    _write_thread_artifact(
        base_dir,
        "thread-panel-font-pdf",
        "report.md",
        "# Report title\n\nA paragraph with **bold** text.\n",
    )

    response = test_client.get("/api/threads/thread-panel-font-pdf/artifacts/export/mnt/user-data/outputs/report.md?format=pdf")

    assert response.status_code == 200
    assert b"DejaVuSans" in response.content
    assert b"DejaVuSans-Bold" in response.content

    markdown_export._resolve_pdf_latin_font_names.cache_clear()


def test_export_markdown_artifact_as_pdf_with_cjk_text(client):
    test_client, base_dir = client
    _write_thread_artifact(
        base_dir,
        "thread-cjk-pdf",
        "report.md",
        "# 中文标题\n\n包含中文段落和 `内联代码`。\n\n```text\n中文代码块\n```\n",
    )

    response = test_client.get("/api/threads/thread-cjk-pdf/artifacts/export/mnt/user-data/outputs/report.md?format=pdf")

    assert response.status_code == 200
    assert response.content.startswith(b"%PDF")
    assert b"STSong-Light" in response.content
    assert b"UniGB-UCS2-H" in response.content


def test_export_markdown_artifact_as_docx_with_cjk_text(client):
    test_client, base_dir = client
    _write_thread_artifact(
        base_dir,
        "thread-cjk-docx",
        "report.md",
        "# 中文标题\n\n正文包含中文。\n\n```text\n中文代码块\n```\n",
    )

    response = test_client.get("/api/threads/thread-cjk-docx/artifacts/export/mnt/user-data/outputs/report.md?format=docx")

    assert response.status_code == 200
    archive = ZipFile(BytesIO(response.content))
    xml = archive.read("word/document.xml").decode("utf-8")
    assert "中文标题" in xml
    assert 'w:eastAsia="SimSun"' in xml

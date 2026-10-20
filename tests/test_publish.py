from pipeline import publish


def test_publish_fills_preview_tags(tmp_path, monkeypatch):
    monkeypatch.setenv("GITHUB_REPOSITORY", "someone/My-Lake")
    monkeypatch.setenv("GITHUB_SHA", "0123456789")
    out = tmp_path / "_site"
    publish.main(out)
    page = (out / "index.html").read_text(encoding="utf-8")
    assert "__OG_" not in page and "?v=dev" not in page
    assert 'content="https://someone.github.io/My-Lake/"' in page
    assert "https://someone.github.io/My-Lake/og.jpg?v=" in page
    assert (out / "og.jpg").exists() and (out / "data" / "site.json").exists()

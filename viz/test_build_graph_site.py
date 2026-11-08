import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import build_graph_site

CGR = Path(sys.executable).parent / "cgr"


def _index(tmp_path: Path, files: dict[str, str]) -> Path:
    repo = tmp_path / "shop"
    for name, text in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    out = tmp_path / "index"
    subprocess.run(
        [CGR, "-q", "index", "--repo-path", repo, "-o", out],
        check=True,
        capture_output=True,
    )
    return out


def _embedded_graph(page: str) -> dict:
    match = re.search(
        r'<script type="application/json" id="graph-data">(.*?)</script>',
        page,
        re.DOTALL,
    )
    return json.loads(match.group(1))


def test_page_holds_procedures_calls_and_includes(tmp_path: Path) -> None:
    index = _index(
        tmp_path,
        {
            "src/main.pli": """%include layout;
main: proc options(main);
  call helper;
  call nowhere;
  put skip list('</script>');
end main;
""",
            "src/helper.pli": "helper: proc;\nend helper;\n",
            "copy/layout.pli": "dcl 1 rec, 2 key char(8);\n",
            "src/pkg.pli": "mathpkg: package;\n  square: proc;\n    call helper;\n  end square;\nend mathpkg;\n",
        },
    )
    output = tmp_path / "graph.html"

    assert build_graph_site.main([str(index), "-o", str(output)]) == 0

    page = output.read_text(encoding="utf-8")
    graph = _embedded_graph(page)
    nodes = {n["id"]: n for n in graph["nodes"]}
    assert graph["project"] == "shop"
    assert nodes["shop.src.main.MAIN"]["mods"] == ["main"]
    assert nodes["shop.src.main.MAIN"]["path"] == "src/main.pli"
    assert nodes["shop.src.main"]["unresolved"] == ["NOWHERE"]
    assert nodes["shop.src.pkg.MATHPKG"]["kind"] == "class"
    assert nodes["shop.src.pkg.MATHPKG.SQUARE"]["kind"] == "method"
    edges = {tuple(e) for e in graph["edges"]}
    assert ("shop.src.main.MAIN", "CALLS", "shop.src.helper.HELPER") in edges
    assert ("shop.src.pkg.MATHPKG.SQUARE", "CALLS", "shop.src.helper.HELPER") in edges
    assert ("shop.src.main", "IMPORTS", "shop.copy.layout") in edges
    assert "cytoscape" in page
    assert "__GRAPH_JSON__" not in page and "/*__CYTOSCAPE__*/" not in page


def test_index_and_json_in_one_step(tmp_path: Path) -> None:
    repo = tmp_path / "shop"
    repo.mkdir()
    (repo / "main.pli").write_text("main: proc;\n  call helper;\nend main;\n")
    (repo / "helper.pli").write_text("helper: proc;\nend helper;\n")
    output = tmp_path / "out" / "graph.json"

    code = build_graph_site.main(
        [str(tmp_path / "index"), "--index", str(repo), "--json", "-o", str(output)]
    )

    assert code == 0
    graph = json.loads(output.read_text(encoding="utf-8"))
    assert ["shop.main.MAIN", "CALLS", "shop.helper.HELPER"] in graph["edges"]


def test_failed_indexing_is_reported(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    code = build_graph_site.main(
        [str(tmp_path / "index"), "--index", str(tmp_path / "missing"), "--json"]
    )
    assert code == 1
    assert "VIZ-003" in caplog.text


def test_missing_index_is_reported(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    assert (
        build_graph_site.main([str(tmp_path), "-o", str(tmp_path / "graph.html")]) == 1
    )
    assert "VIZ-001" in caplog.text
    assert not (tmp_path / "graph.html").exists()


def test_unreadable_index_is_reported(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    (tmp_path / "index.bin").write_bytes(b"\xff\xff\xff not protobuf")
    assert (
        build_graph_site.main([str(tmp_path), "-o", str(tmp_path / "graph.html")]) == 1
    )
    assert "VIZ-002" in caplog.text

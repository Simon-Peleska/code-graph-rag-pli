"""Turn a `cgr index` output directory into one self-contained graph.html.

    cgr index --repo-path SRC -o INDEX_DIR
    uv run --project upstream python viz/build_graph_site.py INDEX_DIR -o graph.html

The page needs no server and no network: the graph data and Cytoscape.js are
inlined. `--index SRC` runs the indexing first; `--json` writes only the
graph data.
"""

import argparse
import json
import logging
import subprocess
import sys
import time
from pathlib import Path

import codec.schema_pb2 as pb

log = logging.getLogger("graph-site")

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "graph.template.html"
# Inlined in this order: each UMD build reads the globals of the ones before it.
LIBRARIES = [
    HERE / "vendor" / name
    for name in (
        "cytoscape.min.js",
        "layout-base.js",
        "cose-base.js",
        "cytoscape-fcose.js",
    )
]
INDEX_FILES = ("index.bin", "nodes.bin", "relationships.bin")

# protobuf payload name -> kind the page knows
KINDS = {
    "module": "module",
    "external_module": "external",
    "class_node": "class",
    "function": "function",
    "method": "method",
}
EDGE_TYPES = {"CALLS", "IMPORTS", "DEFINES", "DEFINES_METHOD"}


class SiteError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"[{code}] {message}")
        self.code = code


def index_repository(repo: Path, index_dir: Path) -> None:
    command = [sys.executable, "-m", "codebase_rag.cli", "-q", "index"]
    command += ["--repo-path", str(repo), "-o", str(index_dir)]
    log.info("indexing %s into %s", repo, index_dir)
    started = time.monotonic()
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        output = (result.stderr or result.stdout).strip()[-2000:]
        raise SiteError(
            "VIZ-003", f"cgr index failed with exit code {result.returncode}: {output}"
        )
    log.info("indexed %s in %.1f s", repo, time.monotonic() - started)


def load_indexes(index_dir: Path) -> list[pb.GraphCodeIndex]:
    found = [index_dir / name for name in INDEX_FILES if (index_dir / name).is_file()]
    if not found:
        raise SiteError(
            "VIZ-001",
            f"no {' / '.join(INDEX_FILES)} in {index_dir}; run `cgr index -o {index_dir}` first",
        )
    indexes = []
    for path in found:
        index = pb.GraphCodeIndex()
        try:
            index.ParseFromString(path.read_bytes())
        except Exception as error:
            raise SiteError(
                "VIZ-002", f"{path} is not a cgr protobuf index: {error}"
            ) from error
        log.info(
            "read %s: %d nodes, %d relationships",
            path,
            len(index.nodes),
            len(index.relationships),
        )
        indexes.append(index)
    return indexes


def build_graph(indexes: list[pb.GraphCodeIndex]) -> dict:
    project = ""
    nodes: dict[str, dict] = {}
    for index in indexes:
        for node in index.nodes:
            payload_name = node.WhichOneof("payload")
            payload = getattr(node, payload_name) if payload_name else None
            if payload_name == "project":
                project = payload.name
            if payload_name not in KINDS:
                continue
            fields = {d.name for d, _ in payload.ListFields()}
            node_id = next(
                getattr(payload, f)
                for f in ("qualified_name", "path", "name")
                if f in fields
            )
            entry = {
                "id": node_id,
                "kind": KINDS[payload_name],
                "name": payload.name or node_id,
            }
            if "path" in fields:
                entry["path"] = payload.path
            if "start_line" in fields:
                entry["line"] = payload.start_line
                entry["end"] = payload.end_line
            if "modifiers" in fields:
                entry["mods"] = list(payload.modifiers)
            if "unresolved_references" in fields:
                entry["unresolved"] = sorted(payload.unresolved_references)
            nodes[node_id] = entry

    edges = set()
    dropped = 0
    for index in indexes:
        for rel in index.relationships:
            rel_type = pb.Relationship.RelationshipType.Name(rel.type)
            if rel_type not in EDGE_TYPES:
                continue
            if rel.source_id not in nodes or rel.target_id not in nodes:
                dropped += 1
                continue
            edges.add((rel.source_id, rel_type, rel.target_id))

    if dropped:
        log.info("dropped %d edges whose ends are not modules or procedures", dropped)
    log.info(
        "graph for project %r: %d nodes, %d edges", project, len(nodes), len(edges)
    )
    return {
        "project": project,
        "nodes": sorted(nodes.values(), key=lambda n: n["id"]),
        "edges": sorted(edges),
    }


def render_page(graph: dict) -> str:
    # `</` inside an inline script would end it early.
    data = json.dumps(graph, separators=(",", ":")).replace("</", "<\\/")
    library = "\n;\n".join(path.read_text(encoding="utf-8") for path in LIBRARIES)
    library = library.replace("</script", "<\\/script")
    page = TEMPLATE.read_text(encoding="utf-8")
    return (
        page.replace("__PROJECT__", graph["project"] or "code graph")
        .replace("/*__CYTOSCAPE__*/", library)
        .replace("__GRAPH_JSON__", data)
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "index_dir", type=Path, help="directory written by `cgr index -o`"
    )
    parser.add_argument("-o", "--output", type=Path, default=Path("graph.html"))
    parser.add_argument(
        "--index", type=Path, metavar="REPO", help="run `cgr index` on REPO first"
    )
    parser.add_argument(
        "--json", action="store_true", help="write the graph data instead of a page"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    try:
        if args.index:
            index_repository(args.index, args.index_dir)
        graph = build_graph(load_indexes(args.index_dir))
    except SiteError as error:
        log.error("%s", error)
        return 1
    text = json.dumps(graph) if args.json else render_page(graph)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text, encoding="utf-8")
    log.info("wrote %s", args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())

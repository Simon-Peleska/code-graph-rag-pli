import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { main } from "./build-graph-site.mjs";

/** @param {Record<string, string>} files */
function shop(files) {
  const dir = mkdtempSync(join(tmpdir(), "graph-site-test-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, "shop", name)), { recursive: true });
    writeFileSync(join(dir, "shop", name), text);
  }
  return dir;
}

test("the page holds procedures, calls and includes", async () => {
  const dir = shop({
    "src/main.pli": "%include layout;\nmain: proc options(main);\n  call helper;\n  call nowhere;\n  put skip list('</script>');\nend main;\n",
    "src/helper.pli": "helper: proc;\nend helper;\n",
    "copy/layout.pli": "dcl 1 rec, 2 key char(8);\n",
    "src/pkg.pli": "mathpkg: package;\n  square: proc;\n    call helper;\n  end square;\nend mathpkg;\n",
  });
  const output = join(dir, "graph.html");

  assert.equal(await main([join(dir, "shop"), "-o", output]), 0);

  const page = readFileSync(output, "utf8");
  const data = /<script type="application\/json" id="graph-data">([^]*?)<\/script>/.exec(page)?.[1];
  const graph = JSON.parse(data ?? "");
  const nodes = Object.fromEntries(graph.nodes.map((/** @type {any} */ n) => [n.id, n]));
  assert.equal(graph.project, "shop");
  assert.deepEqual(nodes["shop.src.main.MAIN"].mods, ["main"]);
  assert.equal(nodes["shop.src.main.MAIN"].path, "src/main.pli");
  assert.deepEqual(nodes["shop.src.main"].unresolved, ["NOWHERE"]);
  assert.equal(nodes["shop.src.pkg.MATHPKG"].kind, "class");
  assert.equal(nodes["shop.src.pkg.MATHPKG.SQUARE"].kind, "method");
  const edges = graph.edges.map((/** @type {string[]} */ e) => e.join(" "));
  assert.ok(edges.includes("shop.src.main.MAIN CALLS shop.src.helper.HELPER"), edges.join("\n"));
  assert.ok(edges.includes("shop.src.pkg.MATHPKG.SQUARE CALLS shop.src.helper.HELPER"), edges.join("\n"));
  assert.ok(edges.includes("shop.src.main IMPORTS shop.copy.layout"), edges.join("\n"));
  assert.ok(page.includes("cytoscape"));
  assert.ok(!page.includes("__GRAPH_JSON__") && !page.includes("/*__CYTOSCAPE__*/"));
});

test("--json writes only the graph data", async () => {
  const dir = shop({ "main.pli": "main: proc;\n  call helper;\nend main;\n", "helper.pli": "helper: proc;\nend helper;\n" });
  const output = join(dir, "out", "graph.json");

  assert.equal(await main([join(dir, "shop"), "--json", "-o", output]), 0);

  const graph = JSON.parse(readFileSync(output, "utf8"));
  assert.ok(graph.edges.some((/** @type {string[]} */ e) => e.join(" ") === "shop.main.MAIN CALLS shop.helper.HELPER"));
});

test("a missing folder is reported as VIZ-001 and writes nothing", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "graph-site-test-"));
  const said = t.mock.method(console, "error", () => {});

  assert.equal(await main([join(dir, "missing"), "-o", join(dir, "graph.html")]), 1);

  assert.ok(said.mock.calls.some((c) => String(c.arguments[0]).includes("VIZ-001")));
  assert.ok(!existsSync(join(dir, "graph.html")));
});

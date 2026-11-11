// Writes out/: the extension, its indexer worker, the graph page's query worker and its MCP
// server as CommonJS bundles, the tree-sitter runtime, grammars and highlights queries they
// load, graph.html, the graph website's page with vscode-elements and Cytoscape inlined, and
// screen.html, the 3270 screen page. The extension fills in __PROJECT__ and __SCREEN_JSON__.
//
//   node build.mjs [--minify]

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("out", { recursive: true });

const viz = new URL("../viz/", import.meta.url);
const library = ["cytoscape.min.js", "layout-base.js", "cose-base.js", "cytoscape-fcose.js"]
  .map((name) => readFileSync(new URL(`vendor/${name}`, viz), "utf-8"))
  .join("\n;\n")
  .replaceAll("</script", "<\\/script");
// Only the vscode-elements components the page uses, as one script.
const components = ["badge", "button", "collapsible", "split-layout", "tab-header", "tab-panel", "tabs", "textfield", "tree", "tree-item"];
const elements = await build({
  stdin: { contents: components.map((name) => `import "@vscode-elements/elements/dist/vscode-${name}/index.js";`).join("\n"), resolveDir: "." },
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  write: false,
  logLevel: "warning",
});
const page = readFileSync(new URL("graph.template.html", viz), "utf-8")
  .replace("/*__ELEMENTS__*/", () => elements.outputFiles[0].text.replaceAll("</script", "<\\/script"))
  .replace("/*__CYTOSCAPE__*/", () => library);
writeFileSync("out/graph.html", page);

// The 3270 screen page: screen/page.js with tn3270's terminal and its components, inlined.
const screenScript = await build({
  entryPoints: ["screen/page.js"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  write: false,
  logLevel: "warning",
});
const screenPage = readFileSync("screen/screen.html", "utf-8").replace("/*__PAGE__*/", () =>
  screenScript.outputFiles[0].text.replaceAll("</script", "<\\/script"),
);
writeFileSync("out/screen.html", screenPage);

copyFileSync("node_modules/web-tree-sitter/web-tree-sitter.wasm", "out/web-tree-sitter.wasm");
for (const name of readdirSync("grammars").filter((n) => n.endsWith(".wasm") || n.endsWith(".scm"))) {
  copyFileSync(`grammars/${name}`, `out/${name}`);
}

await build({
  entryPoints: { extension: "src/extension.js", worker: "src/worker.js", parser: "src/parser.js", mcp: "src/mcp.js", graphpage: "src/graphpage.js" },
  outdir: "out",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // web-tree-sitter's CommonJS build finds its wasm next to the bundle;
  // its ES module build would look for it at an import.meta.url a bundle lacks.
  alias: { "web-tree-sitter": "./node_modules/web-tree-sitter/web-tree-sitter.cjs" },
  external: ["vscode"],
  minify: process.argv.includes("--minify"),
  logLevel: "warning",
});

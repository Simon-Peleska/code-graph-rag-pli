// Writes out/graph.html: the graph website's page with Cytoscape inlined. The
// extension fills in __PROJECT__ and __GRAPH_JSON__ when it shows the graph.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const viz = new URL("../viz/", import.meta.url);
const library = ["cytoscape.min.js", "layout-base.js", "cose-base.js", "cytoscape-fcose.js"]
  .map((name) => readFileSync(new URL(`vendor/${name}`, viz), "utf-8"))
  .join("\n;\n")
  .replaceAll("</script", "<\\/script");
const page = readFileSync(new URL("graph.template.html", viz), "utf-8").replace("/*__CYTOSCAPE__*/", () => library);
mkdirSync("out", { recursive: true });
writeFileSync("out/graph.html", page);

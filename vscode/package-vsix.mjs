// Writes pli-graph.vsix without vsce: a zip holding the extension files under
// `extension/`, an extension.vsixmanifest and a [Content_Types].xml.
//
//   node package-vsix.mjs [--bundle <cgr bundle folder>]
//
// With --bundle it writes pli-graph-win32-x64.vsix, which carries the Windows
// cgr bundle in `extension/cgr/`, so the extension needs nothing else.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const manifest = JSON.parse(readFileSync("package.json", "utf-8"));
const bundleAt = process.argv.indexOf("--bundle");
const bundle = bundleAt > 0 ? process.argv[bundleAt + 1] : undefined;
const target = bundle ? "win32-x64" : undefined;
const out = target ? `${manifest.name}-${target}.vsix` : `${manifest.name}.vsix`;
const files = [
  "package.json",
  "README.md",
  "language-configuration.json",
  "jcl-language-configuration.json",
  "hlasm-language-configuration.json",
  "db2-language-configuration.json",
  "syntaxes/pli.tmLanguage.json",
  "syntaxes/jcl.tmLanguage.json",
  "syntaxes/hlasm.tmLanguage.json",
  "syntaxes/db2.tmLanguage.json",
  "out/extension.cjs",
  "out/graph.html",
];

const xml = (text) => text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${manifest.name}" Version="${manifest.version}" Publisher="${manifest.publisher}"${target ? ` TargetPlatform="${target}"` : ""} />
    <DisplayName>${xml(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(manifest.description)}</Description>
    <Tags>${xml(manifest.keywords.join(","))}</Tags>
    <Categories>${xml(manifest.categories.join(","))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${manifest.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;
const contentTypes = {
  ".cjs": "application/octet-stream",
  ".html": "text/html",
  ".json": "application/json",
  ".md": "text/markdown",
  ".vsixmanifest": "text/xml",
};
for (const file of files) {
  if (!contentTypes[extname(file)]) {
    throw new Error(`[PLG101E] No content type for ${file}.`);
  }
}

// The bundle's files are all opaque to VS Code: Python, DLLs, .pyd, data.
const bundled = [];
const overrides = [];
if (bundle) {
  for (const entry of readdirSync(bundle, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const name = `extension/cgr/${relative(bundle, path).replaceAll("\\", "/")}`;
    const ext = extname(entry.name).toLowerCase();
    if (!ext) overrides.push(name);
    else contentTypes[ext] ??= "application/octet-stream";
    bundled.push([name, path]);
  }
}

const contentTypesXml =
  `<?xml version="1.0" encoding="utf-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  Object.entries(contentTypes)
    .map(([ext, type]) => `<Default Extension="${xml(ext.slice(1))}" ContentType="${type}"/>`)
    .join("") +
  overrides.map((name) => `<Override PartName="/${xml(encodeURI(name))}" ContentType="application/octet-stream"/>`).join("") +
  `</Types>\n`;

// [name in the zip, contents or a path to read, deflate level]
const entries = [
  ["extension.vsixmanifest", Buffer.from(vsixManifest), 9],
  ["[Content_Types].xml", Buffer.from(contentTypesXml), 9],
  ...files.map((file) => [`extension/${file}`, file, 9]),
  // A lower level packs the 270 MB bundle in a fraction of the time, about as small.
  ...bundled.map(([name, path]) => [name, path, 6]),
];
// This writer has no ZIP64: past these limits the archive would be corrupt.
if (entries.length > 0xffff) {
  throw new Error(`[PLG102E] ${entries.length} files are more than a zip without ZIP64 holds.`);
}

// Zip layout: per file a local header and the deflated data, then a central
// directory listing them all, then an end record pointing at the directory.
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
const localParts = [];
const centralParts = [];
let offset = 0;
for (const [name, source, level] of entries) {
  const data = typeof source === "string" ? readFileSync(source) : source;
  const nameBytes = Buffer.from(name);
  const compressed = deflateRawSync(data, { level });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  localParts.push(local, nameBytes, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, nameBytes);

  offset += local.length + nameBytes.length + compressed.length;
  if (offset > 0xffffffff) {
    throw new Error(`[PLG103E] The package passed 4 GB, more than a zip without ZIP64 holds.`);
  }
}
const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

writeFileSync(out, Buffer.concat([...localParts, ...centralParts, end]));
console.log(`Packaged ${out} (${entries.length} files, ${offset} bytes)`);

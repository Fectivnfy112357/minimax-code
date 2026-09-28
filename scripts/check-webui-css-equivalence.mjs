import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import postcss from "postcss";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  options: {
    root: { type: "string" },
    "update-baseline": { type: "boolean", default: false },
    baseline: { type: "string" },
  },
});
const root = path.resolve(values.root ?? repoRoot);
const entry = "packages/webui/src/client/styles/index.css";
const baselinePath = path.resolve(
  root,
  values.baseline ?? "webui-visual-regression/css-equivalence-baseline.json",
);
const records = [];
const imports = [];
const active = new Set();

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function resolveImport(fromFile, request) {
  if (!request.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(fromFile), request);
  return resolved.endsWith(".css") ? resolved : `${resolved}.css`;
}

function describeImportTarget(request, target) {
  return target ? relative(target) : `external:${request}`;
}

function atRuleContext(node, contexts, layer) {
  if (node.name.toLowerCase() === "layer") {
    const name = node.params.trim() || "<anonymous>";
    return { contexts, layer: [...layer, name] };
  }
  return {
    contexts: [...contexts, `@${node.name.toLowerCase()} ${node.params.trim()}`],
    layer,
  };
}

function walk(file, importIndex, importLine, contexts = [], layer = []) {
  if (active.has(file)) throw new Error(`CSS import cycle at ${relative(file)}`);
  active.add(file);
  const css = readFileSync(file, "utf8");
  const ast = postcss.parse(css, { from: file });
  ast.each((node) => {
    if (node.type === "comment") return;
    if (node.type === "atrule" && node.name.toLowerCase() === "import") {
      const request = node.params.match(/^(["'])(.*?)\1/u)?.[2];
      const target = request ? resolveImport(file, request) : null;
      const importRecord = {
        order: imports.length + 1,
        source: relative(file),
        line: node.source?.start?.line ?? null,
        request: node.params.trim(),
        resolved: describeImportTarget(request ?? node.params.trim(), target),
        parentIndex: importIndex,
      };
      imports.push(importRecord);
      if (target) {
        const local = target;
        if (local.startsWith(`${root}${path.sep}`))
          walk(local, importRecord.order, importRecord.line, contexts, layer);
      }
      return;
    }
    if (node.type === "atrule") {
      addNode(node, file, importIndex, importLine, contexts, layer);
      return;
    }
    addNode(node, file, importIndex, importLine, contexts, layer);
  });
  active.delete(file);
}

function addNode(node, file, importIndex, importLine, contexts, layer) {
  if (node.type === "comment") return;
  if (node.type === "atrule") {
    if (node.name.toLowerCase() === "import") {
      // Imports nested in conditional at-rules retain their lexical condition.
      const request = node.params.match(/^(["'])(.*?)\1/u)?.[2];
      const target = request ? resolveImport(file, request) : null;
      const record = {
        order: imports.length + 1,
        source: relative(file),
        line: node.source?.start?.line ?? null,
        request: node.params.trim(),
        resolved: describeImportTarget(request ?? node.params.trim(), target),
        parentIndex: importIndex,
        contexts,
        layer,
      };
      imports.push(record);
      if (target) {
        const local = target;
        if (local.startsWith(`${root}${path.sep}`))
          walk(local, record.order, record.line, contexts, layer);
      }
    } else if (node.nodes) {
      const directDeclarations = node.nodes.filter((child) => child.type === "decl");
      if (directDeclarations.length > 0) {
        records.push({
          position: records.length + 1,
          selectors: `@${node.name.toLowerCase()} ${node.params.trim()}`.trim(),
          declarations: directDeclarations.map((child) => ({
            property: child.prop,
            value: child.value.trim(),
            important: Boolean(child.important),
          })),
          layer,
          conditions: contexts,
          source: relative(file),
          line: node.source?.start?.line ?? null,
          importIndex,
          importLine,
        });
      }
      const next = atRuleContext(node, contexts, layer);
      if (directDeclarations.length === 0)
        node.each((child) => addNode(child, file, importIndex, importLine, next.contexts, next.layer));
    }
    return;
  }
  if (node.type !== "rule") return;
  const declarations = [];
  node.each((child) => {
    if (child.type === "decl")
      declarations.push({ property: child.prop, value: child.value.trim(), important: Boolean(child.important) });
  });
  records.push({
    position: records.length + 1,
    selectors: node.selector.trim(),
    declarations,
    layer,
    conditions: contexts,
    source: relative(file),
    line: node.source?.start?.line ?? null,
    importIndex,
    importLine,
  });
}

function collect() {
  const entryPath = path.join(root, entry);
  if (!readFileSync(entryPath, "utf8")) throw new Error(`Empty CSS entry: ${entry}`);
  walk(entryPath, 0, 1);
  return { schemaVersion: 1, entry, imports, rules: records };
}

function describe(item) {
  if (!item) return "<end of stream>";
  return JSON.stringify(item);
}

function fail(kind, expected, actual) {
  const location = expected ?? actual;
  console.error(`CSS equivalence FAILED: ${kind}`);
  console.error(`Source: ${location?.source ?? entry}:${location?.line ?? "?"}`);
  if (actual && expected && (actual.source !== expected.source || actual.line !== expected.line))
    console.error(`Actual source: ${actual.source}:${actual.line}`);
  console.error(`Expected: ${describe(expected)}`);
  console.error(`Actual:   ${describe(actual)}`);
  process.exitCode = 1;
}

let actual;
try {
  actual = collect();
} catch (error) {
  console.error(`CSS equivalence FAILED: ${error.message}`);
  process.exit(1);
}

if (values["update-baseline"]) {
  writeFileSync(baselinePath, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`Updated CSS equivalence baseline: ${path.relative(root, baselinePath)}`);
  process.exit(0);
}

let expected;
try {
  expected = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch (error) {
  console.error(
    `CSS equivalence baseline unavailable at ${path.relative(root, baselinePath)}. ` +
      `This gate requires a complete development checkout; published source exports intentionally omit webui-visual-regression/. ` +
      `Restore the reviewed baseline or explicitly run --update-baseline in a reviewed checkout. (${error.code ?? error.message})`,
  );
  process.exit(2);
}

for (let i = 0; i < Math.max(expected.imports.length, actual.imports.length); i++) {
  const before = expected.imports[i];
  const after = actual.imports[i];
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    fail(`import order/content differs at import ${i + 1}`, before, after);
    process.exit(1);
  }
}
for (let i = 0; i < Math.max(expected.rules.length, actual.rules.length); i++) {
  const before = expected.rules[i];
  const after = actual.rules[i];
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    fail(`rule stream differs at position ${i + 1}`, before, after);
    process.exit(1);
  }
}
console.log(`CSS equivalence passed: ${actual.rules.length} ordered rules, ${actual.imports.length} imports.`);

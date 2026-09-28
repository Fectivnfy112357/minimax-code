import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const repo = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(path.join(os.tmpdir(), "webui-css-mutations-"));
const styleRoot = "packages/webui/src/client/styles";
const checker = path.join(repo, "scripts/check-webui-css-equivalence.mjs");
const sourceRoot = path.join(repo, styleRoot);
const temporaryStyles = path.join(temporary, styleRoot);
const source = readFileSync(path.join(sourceRoot, "shell.css"), "utf8");

function location(node) {
  return { start: node.source.start.offset, end: node.source.end.offset + 1, line: node.source.start.line };
}

function cssRules(text) {
  const ast = postcss.parse(text, { from: "shell.css" });
  const found = [];
  ast.walkRules((rule) => {
    if (rule.nodes?.some((node) => node.type === "decl")) found.push(rule);
  });
  return found;
}

function sameSpecificityPair(rules) {
  const seen = new Map();
  for (const rule of rules) {
    const key = rule.selector;
    const previous = seen.get(key);
    if (previous) return [previous, rule];
    seen.set(key, rule);
  }
  throw new Error("No repeated selector found to provide an exact same-specificity reorder pair");
}

function replaceRange(text, node, replacement) {
  const { start, end } = location(node);
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function mutateRuleOrder() {
  const [first, second] = sameSpecificityPair(cssRules(source));
  const a = location(first);
  const b = location(second);
  const firstText = source.slice(a.start, a.end);
  const secondText = source.slice(b.start, b.end);
  return {
    css: `${source.slice(0, a.start)}${secondText}${source.slice(a.end, b.start)}${firstText}${source.slice(b.end)}`,
    expectedLine: a.line,
  };
}

function mutateDeclaration() {
  const rule = cssRules(source).find((candidate) => candidate.nodes.some((node) => node.type === "decl"));
  const declaration = rule.nodes.find((node) => node.type === "decl");
  const replacement = `${declaration.prop}: __css_equivalence_mutated__${declaration.important ? " !important" : ""};`;
  return { css: replaceRange(source, declaration, replacement), expectedLine: rule.source.start.line };
}

function mutateDeleteRule() {
  const [rule] = cssRules(source);
  return { css: replaceRange(source, rule, ""), expectedLine: rule.source.start.line };
}

function runMutation(name, mutate) {
  const mutation = mutate();
  writeFileSync(path.join(temporaryStyles, "shell.css"), mutation.css);
  const result = spawnSync(process.execPath, [checker, "--root", temporary], {
    cwd: repo,
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;
  const expectedLocation = `Source: ${styleRoot}/shell.css:${mutation.expectedLine}`;
  assert.notEqual(result.status, 0, `${name} should fail equivalence check`);
  assert.ok(output.includes("CSS equivalence FAILED"), `${name}: checker failure banner missing\n${output}`);
  assert.ok(output.includes(expectedLocation), `${name}: expected source location missing (${expectedLocation})\n${output}`);
  console.log(`PASS ${name} (exit ${result.status})`);
  console.log(output.trim());
}

try {
  mkdirSync(path.join(temporary, "webui-visual-regression"), { recursive: true });
  cpSync(
    path.join(repo, "webui-visual-regression/css-equivalence-baseline.json"),
    path.join(temporary, "webui-visual-regression/css-equivalence-baseline.json"),
  );
  cpSync(sourceRoot, temporaryStyles, { recursive: true });
  for (const [name, mutation] of [
    ["same-specificity rule reorder", mutateRuleOrder],
    ["declaration value change", mutateDeclaration],
    ["rule deletion", mutateDeleteRule],
  ]) {
    cpSync(sourceRoot, temporaryStyles, { recursive: true });
    runMutation(name, mutation);
  }
  const productDiff = spawnSync("git", ["diff", "--exit-code", "--", styleRoot], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(productDiff.status, 0, "Product stylesheet files must remain unchanged");
  console.log("PASS product stylesheet git diff is empty");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

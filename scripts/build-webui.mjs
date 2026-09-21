// Build the WebUI package separately from the CLI bundle.
//
// ADR 0005 says the WebUI gets its own build graph and metafile so the
// standalone CLI entry points stay untouched. The server module is
// bundled with esbuild for Node; the client module with esbuild for the
// browser; both emit a metafile that `scripts/check-webui-boundary.mjs`
// inspects.
//
// Vite's own bundler is not invoked here on purpose: ticket 01 ships
// without a transport, so the client bundle is a single JS file plus the
// HTML wrapper, and adding a second tool with its own metafile format
// would defeat the boundary check.
//
// ADR 0010: only the esbuild artifact is verified and shipped. The
// development server is not a verification surface, and a check that only
// passes there proves nothing.

import { build } from "esbuild";
import {
  readFileSync,
  rmSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readExtraction } from "./lib/release-metadata.mjs";
import { createWorkspaceSourcesPlugin } from "./lib/workspace-sources-plugin.mjs";
import { copyMcodeToolsArtifact } from "./lib/mcode-tools-artifact.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageDir = path.join(root, "packages/webui");
const outdir = path.join(root, "dist-webui");
const metadata = readExtraction(root);
const packages = new Map(
  metadata.packageRoots.map((directory) => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, directory, "package.json"), "utf8"),
    );
    return [manifest.name, { directory, manifest }];
  }),
);
const sourcePlugin = createWorkspaceSourcesPlugin(packages, root, [
  "@mavis/local-runtime-v2",
  "@mavis/config",
  "@mavis/mcode-tools-host",
  "@mavis/agent-tools",
  "@mavis/agent-tools/desktop",
]);

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// Compile the stylesheet first so the bundled client HTML can link to it
// (ADR 0010). The stylesheet is its own artifact; both the development
// server and the packaged esbuild output consume the same compiled CSS.
{
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/build-webui-styles.mjs")],
    { stdio: "inherit", cwd: root },
  );
  if (result.status !== 0) {
    throw new Error(
      `WebUI stylesheet build failed (exit ${result.status}); ` +
        "the styles pipeline is run before the bundle so the stylesheet " +
        "and bundle are produced by the same build.",
    );
  }
}

const server = await build({
  absWorkingDir: packageDir,
  entryPoints: {
    server: "src/server/index.ts",
    "mcode-tools": "src/server/mcode-tools-entry.ts",
    shared: "src/shared/placeholder.ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outdir: path.join(outdir, "server"),
  metafile: true,
  // The harness layer ships as an installed workspace package at
  // runtime; keeping it out of the bundle means the server entry
  // resolves `@mavis/local-runtime-v2` via `node_modules/` like any
  // third-party dependency. The boundary check therefore never sees
  // the harness internals in the build graph.
  external: [
    "@mavis/local-runtime-v2",
    "@mavis/config",
    "@mavis/mcode-tools-host",
    "@mavis/agent-tools",
    "@mavis/agent-tools/desktop",
  ],
  plugins: [sourcePlugin],
  logLevel: "info",
});

const client = await build({
  absWorkingDir: packageDir,
  entryPoints: { client: "src/client/main.tsx" },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outdir: path.join(outdir, "client"),
  metafile: true,
  jsx: "automatic",
  loader: { ".html": "text" },
  logLevel: "info",
});

// Merge the two metafiles into one: every input the build ever reached
// must be visible to the boundary check. esbuild's outputs side is
// dropped; the boundary check only needs inputs and the warnings list.
const merged = {
  inputs: { ...server.metafile.inputs, ...client.metafile.inputs },
  outputs: { ...server.metafile.outputs, ...client.metafile.outputs },
};

writeFileSync(
  path.join(outdir, "metafile.json"),
  JSON.stringify(merged, null, 2) + "\n",
);

const htmlSource = path.join(packageDir, "src/client/index.html");
if (existsSync(htmlSource))
  cpSync(htmlSource, path.join(outdir, "client/index.html"));

// The WebUI server owns its own mcode-tools process boundary. Keep the
// embedded entry and the command launcher beside the server bundle so the
// host's short-lived broker can validate the exact artifact it starts.
await copyMcodeToolsArtifact(root, path.join(outdir, "server"));
cpSync(
  path.join(root, "packages/tui/src/cli/mcode-tools-launchers"),
  path.join(outdir, "server/internal-bin"),
  { recursive: true },
);
chmodSync(path.join(outdir, "server/mcode-tools.js"), 0o755);
chmodSync(path.join(outdir, "server/internal-bin/mcode-tools"), 0o755);

console.log(
  `Built WebUI foundation. ` +
    `server inputs: ${
      Object.keys(server.metafile.inputs).length
    }; ` +
    `client inputs: ${
      Object.keys(client.metafile.inputs).length
    }; total: ${Object.keys(merged.inputs).length}.`,
);

# WebUI package on the npm registry

The WebUI is packaged as `@fectivnfy112358/minimax-code-web` and published to
`https://registry.npmjs.org` with the `preview` dist-tag. The repository's
`.github/workflows/webui-npm-preview.yml` workflow publishes through npm trusted
publishing (OIDC) and holds no npm token. A trusted publisher can only be
configured once the package exists on npmjs.com, so the first version is
published from a machine that holds a token.

## First publication

1. Build the package and inspect the tarball:

   ```sh
   pnpm install --frozen-lockfile
   pnpm run package:webui-npm -- --version 0.1.0-preview.0 --outdir /tmp/minimax-code-web
   npm pack --dry-run /tmp/minimax-code-web
   ```

2. Create a granular access token on npmjs.com with **Read and write (publish
   and stage)** access. Put it in the user-level `~/.npmrc`; never in the
   repository's `.npmrc`, which is tracked by Git:

   ```ini
   //registry.npmjs.org/:_authToken=<token>
   ```

3. Publish the first version:

   ```sh
   npm publish /tmp/minimax-code-web --tag preview
   ```

   `publishConfig.access` in `release/webui-npm/package.json` already makes the
   scoped package public.

## Enable trusted publishing

On npmjs.com, open the package settings, add a trusted publisher for GitHub
Actions, and use:

- **Organization or user**: `fectivnfy112358`
- **Repository**: `minimax-code`
- **Workflow filename**: `webui-npm-preview.yml` (filename only, including the
  extension)
- **Environment name**: leave empty
- **Allowed actions**: `npm publish`

The workflow declares no GitHub environment and no `NODE_AUTH_TOKEN`, so these
values must stay in sync with it. Once a tag-triggered release has been verified,
revoke the token from step 2.

## Publish a preview

1. Merge the intended changes into `webui` and confirm the package build is
   ready.
2. Create a tag on that commit using the package version, for example
   `webui-v0.1.0-preview.1`.
3. Push that tag. The workflow checks the preview version format, builds the
   standalone package, inspects the npm tarball contents, then publishes to
   `https://registry.npmjs.org` with the `preview` dist-tag.

Provenance attestations are generated automatically by the trusted publish; the
`--provenance` flag is not needed. `repository.url` in
`release/webui-npm/package.json` must keep matching the GitHub repository or
provenance validation fails.

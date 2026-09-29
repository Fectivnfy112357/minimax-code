# WebUI package on GitHub Packages

The WebUI is packaged as `@fectivnfy112357/minimax-code-web` and published to
GitHub Packages with the `preview` dist-tag. The repository's
`.github/workflows/webui-npm-preview.yml` workflow uses the repository-scoped
`GITHUB_TOKEN`; no npmjs token or npmjs publication is involved.

## Publish a preview

1. Merge the intended changes into `webui` and confirm the package build is
   ready.
2. Create a tag on that commit using the package version, for example
   `webui-v0.1.0-preview.0`.
3. Push that tag. The workflow checks the preview version format, builds the
   standalone package, inspects the npm tarball contents, then publishes to
   `https://npm.pkg.github.com` with the `preview` dist-tag.

The first publication is private by default. Change the package visibility to
public in the GitHub package settings if public access is intended. GitHub
Packages npm clients also need GitHub authentication with `read:packages` to
install packages, including public ones.

## Local package build

```sh
pnpm install --frozen-lockfile
pnpm run package:webui-npm -- --version 0.1.0-preview.0 --outdir /tmp/minimax-code-web
npm pack --dry-run /tmp/minimax-code-web
```

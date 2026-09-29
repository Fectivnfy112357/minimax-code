# MiniMax Code WebUI preview package

This package runs the MiniMax Code WebUI and its local runtime on your machine.
It is published to GitHub Packages under the `preview` dist-tag.

GitHub Packages npm installs require a GitHub personal access token (classic)
with `read:packages`. Configure it in `~/.npmrc`:

```ini
@fectivnfy112357:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Set `GITHUB_PACKAGES_TOKEN` in your shell, then install the preview:

```sh
npm install --global @fectivnfy112357/minimax-code-web@preview
mcode-webui
```

The server listens on `http://127.0.0.1:8787/`. Set `WEBUI_SERVER_PORT` to
change the port or `MINIMAX_DATA_DIR` to change the local data directory. The
default data directory is `~/.minimax`.

The package requires a supported Node.js version shown in its `engines` field.

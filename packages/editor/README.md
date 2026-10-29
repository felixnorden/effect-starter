# Editor adapters

Neovim (`nvim/`) and Vim (`vim/`) start the preview server, send document and
cursor updates, and open the browser. Both adapters keep the same commands:

- `:MarkdownPreview`
- `:MarkdownPreviewStop`
- `:MarkdownPreviewToggle`

## Install

Add the adapter directory to `runtimepath`. The server can be a compiled binary
in the plugin's gitignored `bin/` directory, or a checkout run with Bun.

### lazy.nvim

```lua
{
  dir = vim.fn.expand("~/development/markdown-viewer/packages/editor/nvim"),
  name = "markdown-viewer",
  build = "./install.sh",
  cmd = { "MarkdownPreview", "MarkdownPreviewStop", "MarkdownPreviewToggle" },
  keys = {
    {
      "<leader>cp",
      ft = "markdown",
      "<cmd>MarkdownPreviewToggle<cr>",
      desc = "Markdown Preview",
    },
  },
}
```

### vim-plug

```vim
Plug '/Users/me/development/markdown-viewer/packages/editor/nvim', { 'do': './install.sh' }
Plug '/Users/me/development/markdown-viewer/packages/editor/vim', { 'do': './install.sh' }
```

## Build the server

From a checkout:

```sh
bun run build:server
```

This writes:

```text
packages/editor/bin/mdv-<os>-<arch>[.exe]
packages/editor/bin/client/
```

`bin/` is gitignored. Never commit the binary or the client build. A checkout
build is shared by the Neovim and Vim adapters.

`install.sh` is the plugin-manager build hook. Each adapter has a thin
`install.sh` wrapper that runs the package-level script, so a plugin manager can
use `./install.sh` from the adapter root.

1. If the checkout has `packages/app/src/main.ts` and Bun is on `PATH`, it runs
   `bun run build:server`.
2. Otherwise it downloads `mdv-<os>-<arch>.tar.gz` and its `.sha256` from
   `MDV_RELEASE_BASE_URL`, verifies the checksum, and extracts the binary and
   `client/` into `packages/editor/bin/`.

The tarball layout is:

```text
mdv-<os>-<arch>[.exe]
client/index.html
client/assets/...
```

For a read-only plugin directory, set `MDV_INSTALL_DIR` and point
`g:markdown_viewer_server` at the installed binary.

## Server discovery

The adapter tries, in order:

1. `g:markdown_viewer_server`
2. `bin/mdv-<os>-<arch>` in the adapter directory (`.exe` first on Windows)
3. `bin/mdv-<os>-<arch>` in the shared `packages/editor/bin` directory
4. `bun <checkout>/packages/app/src/main.ts`

The compiled binary serves `client/` from the directory beside the executable.
A checkout serves `packages/app/dist/client`.

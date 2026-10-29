# Editor adapters

Neovim (`nvim/`) and Vim (`vim/`) start the preview server, send document and
cursor updates, and open the browser. Both adapters keep the same commands:

- `:MarkdownPreview`
- `:MarkdownPreviewStop`
- `:MarkdownPreviewToggle`

Add the adapter directory to `runtimepath`. Discovery runs the checkout's
`packages/app/src/main.ts` with Bun when no other server is configured.

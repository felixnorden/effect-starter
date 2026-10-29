-- Keep the probe's runtime small: the generated codec and nothing else.
-- `scripts/editor-probe.ts` runs this file with `nvim --headless`.
local source = debug.getinfo(1, "S").source:sub(2)
local root = vim.fn.fnamemodify(source, ":p:h:h:h:h")

vim.opt.runtimepath:append(root .. "/packages/editor/nvim")
vim.opt.swapfile = false
vim.opt.shadafile = "NONE"

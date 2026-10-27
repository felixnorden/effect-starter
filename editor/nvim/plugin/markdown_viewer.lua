-- No setup() table, no mkdp alias command, no <Plug> alias (settled decision 10).
-- The commands carry the behaviour; the maps fire the commands through <Cmd>, so
-- insert mode needs no mode change.

vim.api.nvim_create_user_command("MarkdownPreview", function()
  require("markdown_viewer.session").preview()
end, {})

vim.api.nvim_create_user_command("MarkdownPreviewStop", function()
  require("markdown_viewer.session").stop()
end, {})

vim.api.nvim_create_user_command("MarkdownPreviewToggle", function()
  require("markdown_viewer.session").toggle()
end, {})

vim.keymap.set("n", "<Plug>(MarkdownPreview)", "<Cmd>MarkdownPreview<CR>", { silent = true })
vim.keymap.set("i", "<Plug>(MarkdownPreview)", "<Cmd>MarkdownPreview<CR>", { silent = true })
vim.keymap.set("n", "<Plug>(MarkdownPreviewStop)", "<Cmd>MarkdownPreviewStop<CR>", { silent = true })
vim.keymap.set("i", "<Plug>(MarkdownPreviewStop)", "<Cmd>MarkdownPreviewStop<CR>", { silent = true })
vim.keymap.set("n", "<Plug>(MarkdownPreviewToggle)", "<Cmd>MarkdownPreviewToggle<CR>", { silent = true })
vim.keymap.set("i", "<Plug>(MarkdownPreviewToggle)", "<Cmd>MarkdownPreviewToggle<CR>", { silent = true })

-- Commands and maps come from the configuration: buffer-local in a configured
-- filetype, or global when `preview.command_for_global` is on. The baseline
-- plugin in the same runtime path is a conflict, reported before any command
-- exists. A later `preview.filetypes` change takes effect at the next FileType
-- event; no loaded-buffer sweep runs, and the stale window is recorded (G-50).

if vim.g.loaded_markdown_viewer then
  return
end
vim.g.loaded_markdown_viewer = 1

local source = debug.getinfo(1, "S").source:sub(2)
local plugin_dir = vim.fn.fnamemodify(source, ":p:h:h")

local function baseline_dir()
  for _, dir in ipairs(vim.api.nvim_list_runtime_paths()) do
    if vim.fn.filereadable(dir .. "/plugin/mkdp.vim") == 1 then
      return dir
    end
  end
  return nil
end

local baseline = baseline_dir()
if baseline ~= nil then
  vim.notify(
    string.format(
      "Markdown Viewer: both plugins are on the runtime path: the baseline plugin at %s and this plugin at %s. Remove the baseline plugin.",
      baseline,
      plugin_dir
    ),
    vim.log.levels.ERROR
  )
  return
end

local viewer = require("markdown_viewer")

vim.api.nvim_create_user_command("MarkdownViewerHealth", function()
  require("markdown_viewer.health").check()
end, { force = true })

local function command_set(bufnr)
  local map = { silent = true }
  if bufnr ~= nil then
    map.buffer = bufnr
  end

  if bufnr ~= nil then
    for _, name in ipairs({ "MarkdownPreview", "MarkdownPreviewStop", "MarkdownPreviewToggle" }) do
      pcall(vim.api.nvim_buf_del_user_command, bufnr, name)
    end
    vim.api.nvim_buf_create_user_command(bufnr, "MarkdownPreview", function()
      require("markdown_viewer.session").preview()
    end, {})
    vim.api.nvim_buf_create_user_command(bufnr, "MarkdownPreviewStop", function()
      require("markdown_viewer.session").stop()
    end, {})
    vim.api.nvim_buf_create_user_command(bufnr, "MarkdownPreviewToggle", function()
      require("markdown_viewer.session").toggle()
    end, {})
  else
    vim.api.nvim_create_user_command("MarkdownPreview", function()
      require("markdown_viewer.session").preview()
    end, { force = true })
    vim.api.nvim_create_user_command("MarkdownPreviewStop", function()
      require("markdown_viewer.session").stop()
    end, { force = true })
    vim.api.nvim_create_user_command("MarkdownPreviewToggle", function()
      require("markdown_viewer.session").toggle()
    end, { force = true })
  end

  vim.keymap.set("n", "<Plug>(MarkdownPreview)", "<Cmd>MarkdownPreview<CR>", map)
  vim.keymap.set("i", "<Plug>(MarkdownPreview)", "<Cmd>MarkdownPreview<CR>", map)
  vim.keymap.set("n", "<Plug>(MarkdownPreviewStop)", "<Cmd>MarkdownPreviewStop<CR>", map)
  vim.keymap.set("i", "<Plug>(MarkdownPreviewStop)", "<Cmd>MarkdownPreviewStop<CR>", map)
  vim.keymap.set("n", "<Plug>(MarkdownPreviewToggle)", "<Cmd>MarkdownPreviewToggle<CR>", map)
  vim.keymap.set("i", "<Plug>(MarkdownPreviewToggle)", "<Cmd>MarkdownPreviewToggle<CR>", map)
end

local function configured(filetype)
  local filetypes = viewer.refresh().values["preview.filetypes"] or { "markdown" }
  for _, entry in ipairs(filetypes) do
    if entry == filetype then
      return true
    end
  end
  return false
end

local group = vim.api.nvim_create_augroup("markdown_viewer_filetype", { clear = true })
vim.api.nvim_create_autocmd("FileType", {
  group = group,
  callback = function(args)
    if configured(vim.bo[args.buf].filetype) then
      command_set(args.buf)
      require("markdown_viewer.session").auto_start(args.buf)
    end
  end,
})

if viewer.get().values["preview.command_for_global"] == true then
  command_set(nil)
end

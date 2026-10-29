-- In-editor setup and bookkeeping for the recorded refresh run. The RPC client
-- in `scripts/editor-refresh.ts` drives the phases; this file only exposes the
-- facts the editor owns.
local source = debug.getinfo(1, "S").source:sub(2)
local root = vim.fn.fnamemodify(source, ":p:h:h:h:h")
vim.opt.runtimepath:append(root .. "/packages/editor/nvim")
vim.cmd("runtime plugin/markdown_viewer.lua")
vim.opt.swapfile = false
vim.opt.shadafile = "NONE"

local stub = assert(os.getenv("MDV_STUB_SERVER"), "MDV_STUB_SERVER")
local record_path = assert(os.getenv("MDV_STUB_RECORD"), "MDV_STUB_RECORD")
local report_path = assert(os.getenv("MDV_DRIVER_REPORT"), "MDV_DRIVER_REPORT")
local phase = os.getenv("MDV_REFRESH_PHASE") or "refresh"

vim.g.markdown_viewer_server = stub

local report = {
  phase = phase,
  opener = {},
  notifies = {},
  failures = {},
}

local cursorEvents = 0
vim.api.nvim_create_autocmd("CursorMoved", {
  callback = function()
    cursorEvents = cursorEvents + 1
  end,
})

vim.ui.open = function(target)
  report.opener[#report.opener + 1] = target
end

vim.notify = function(text)
  report.notifies[#report.notifies + 1] = tostring(text)
end

local fixture = vim.fn.tempname() .. ".md"
vim.fn.writefile({ "# Refresh fixture", "", "cursor line 0 " .. string.rep("-", 30) }, fixture)

local function bufferText()
  return table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\n") .. "\n"
end

local mdv = {
  fixture = fixture,
  report = report,
}

function mdv.open()
  vim.cmd("edit " .. vim.fn.fnameescape(fixture))
  vim.cmd("MarkdownPreview")
end

function mdv.stop()
  vim.cmd("MarkdownPreviewStop")
end

local bumps = {}

function mdv.bump(tag)
  bumps[tag] = (bumps[tag] or 0) + 1
  vim.api.nvim_buf_set_lines(0, 2, 3, false, { string.format("bump %s %d", tag, bumps[tag]) })
end

function mdv.write()
  vim.cmd("write")
end

function mdv.unmodify()
  vim.bo.modified = false
end

function mdv.suffix(char)
  local position = vim.api.nvim_win_get_cursor(0)
  vim.api.nvim_buf_set_text(
    0,
    position[1] - 1,
    position[2],
    position[1] - 1,
    position[2],
    { char }
  )
end

function mdv.edit(step)
  vim.api.nvim_buf_set_lines(0, 0, 1, false, {
    string.format("cursor line %d %s", step, string.rep("-", 30)),
  })
  vim.api.nvim_win_set_cursor(0, { 1, step - 1 })
end

function mdv.overcap()
  local wire = require("markdown_viewer.generated.wire")
  vim.api.nvim_buf_set_lines(0, 0, -1, false, { string.rep("x", wire.max_frame_bytes) })
end

function mdv.check_overcap()
  local messages = require("markdown_viewer.messages")
  local wire = require("markdown_viewer.generated.wire")
  report.overCapMessageOk = #report.notifies == 1
    and report.notifies[1] == messages.oversize(wire.max_frame_bytes)
  report.overCapMessage = report.notifies[1]
end

function mdv.check_augroup()
  local ok, autocmds = pcall(vim.api.nvim_get_autocmds, { group = "markdown_viewer_refresh" })
  local count = ok and #autocmds or 0
  report.augroupCount = count
  report.augroupEmpty = count == 0
  report.augroupBeforeQuit = count > 0
end

function mdv.capture(id)
  if id ~= nil then
    report.captureId = id
  end
  local text = bufferText()
  report.textLength = #text
  if #text <= 1048576 then
    report.finalText = text
    report.finalDigest = vim.fn.sha256(text)
  end
  report.cursorEvents = cursorEvents
  report.uis = #vim.api.nvim_list_uis()
  local ok, autocmds = pcall(vim.api.nvim_get_autocmds, { group = "markdown_viewer_refresh" })
  report.moduleAutocmds = ok and #autocmds or -1
  vim.fn.writefile({ vim.json.encode(report) }, report_path)
end

function mdv.dump_buffer()
  local path = vim.fn.fnamemodify(record_path, ":h") .. "/final-buffer.txt"
  local file = io.open(path, "wb")
  if file ~= nil then
    file:write(bufferText())
    file:close()
  end
end

_G.mdv = mdv
return true

-- One real headless Neovim run: two buffers, two server jobs, one real page
-- opened per row. Prints the mode it used so a green run cannot claim evidence
-- it did not get. Run with:
--   nvim --headless -u NONE -l packages/editor/tests/sessions-driver.lua
local source = debug.getinfo(1, "S").source:sub(2)
local root = vim.fn.fnamemodify(source, ":p:h:h:h:h")
vim.opt.runtimepath:prepend(root .. "/packages/editor/nvim")
vim.opt.hidden = true

local lua_dir = root .. "/packages/editor/nvim/lua"
package.path = lua_dir .. "/?.lua;" .. lua_dir .. "/?/init.lua;" .. package.path

local function out(line)
  io.stdout:write(line .. "\n")
  io.stdout:flush()
end

local function fail(message)
  out("FAIL editor:sessions: " .. message)
  os.exit(1)
end

local dir = vim.fn.tempname()
vim.fn.mkdir(dir, "p")
local a = dir .. "/a.md"
local b = dir .. "/b.md"
vim.fn.writefile({ "# A" }, a)
vim.fn.writefile({ "# B" }, b)

local notes = {}
local original_notify = vim.notify
vim.notify = function(text, level)
  notes[#notes + 1] = text
  original_notify(text, level)
end
local opened = {}
vim.ui.open = function(url)
  opened[#opened + 1] = url
end

local viewer = require("markdown_viewer")
viewer.setup({ preview = { auto_start = true, auto_close = true } })
vim.cmd("runtime! plugin/markdown_viewer.lua")
local session = require("markdown_viewer.session")

local function row_count()
  local count = 0
  for _ in pairs(session.rows()) do
    count = count + 1
  end
  return count
end

local function wait_open(expected)
  local ok = vim.wait(15000, function()
    local open = 0
    for _, row in pairs(session.rows()) do
      if row.state == "open" then
        open = open + 1
      end
    end
    return open == expected
  end, 50)
  if not ok then
    fail("timed out waiting for " .. expected .. " open rows: " .. vim.inspect(session.rows()) .. " notes " .. table.concat(notes, " | "))
  end
end

-- Two buffers: preview both, then stop one.
vim.cmd("edit " .. vim.fn.fnameescape(a))
vim.bo.filetype = "markdown"
vim.cmd("MarkdownPreview")
vim.cmd("split " .. vim.fn.fnameescape(b))
vim.bo.filetype = "markdown"
vim.cmd("MarkdownPreview")
wait_open(2)
if row_count() ~= 2 then
  fail("two buffers did not start two rows")
end
out("REAL nvim two buffers")

-- The health report sees a live session and names its open ports.
local health = require("markdown_viewer.health")
local ports = nil
for _, entry in ipairs(health.report()) do
  if entry.key == "ports" then
    ports = entry.value
  end
end
if ports == nil or ports == "none" then
  fail("health report named no live session ports")
end
out("REAL nvim health live ports " .. ports)

local first = vim.fn.bufnr(a)
local window = vim.fn.win_findbuf(first)[1]
vim.api.nvim_set_current_win(window)
vim.cmd("MarkdownPreviewStop")
vim.wait(5000, function()
  return row_count() == 1
end, 50)
if row_count() ~= 1 then
  fail("stopping one row left " .. row_count() .. " rows")
end
out("REAL nvim stop one row")

-- Hiding the remaining buffer with auto-close ends its row.
local second = vim.fn.bufnr(b)
vim.cmd("bdelete " .. second)
vim.wait(5000, function()
  return row_count() == 0
end, 50)
if row_count() ~= 0 then
  fail("deleting the buffer left " .. row_count() .. " rows")
end
out("REAL nvim auto-close one row")

-- A combine switch keeps one row, one address and one page.
local c = dir .. "/c.md"
local d = dir .. "/d.md"
vim.fn.writefile({ "# C" }, c)
vim.fn.writefile({ "# D" }, d)
viewer.setup({ preview = { auto_start = true, auto_close = true, combine = true } })
vim.cmd("edit " .. vim.fn.fnameescape(c))
vim.bo.filetype = "markdown"
vim.cmd("MarkdownPreview")
wait_open(1)
local opened_before = #opened
local url_before = nil
for _, row in pairs(session.rows()) do
  url_before = row.url
end
vim.cmd("edit " .. vim.fn.fnameescape(d))
vim.bo.filetype = "markdown"
vim.cmd("MarkdownPreview")
vim.wait(5000, function()
  return session.rows()[vim.fn.bufnr(d)] ~= nil
end, 50)
local combined = session.rows()[vim.fn.bufnr(d)]
if combined == nil or row_count() ~= 1 then
  fail("combine switch did not keep one row")
end
if #opened ~= opened_before then
  fail("combine switch opened a second page")
end
if combined.url ~= url_before then
  fail("combine switch changed the page address")
end
out("REAL nvim combine switch")

vim.cmd("MarkdownPreviewStop")
vim.wait(5000, function()
  return row_count() == 0
end, 50)

-- The configured port belongs to the earliest live row; a sibling asks for 0.
local tcp = vim.uv.new_tcp()
tcp:bind("127.0.0.1", 0)
local configured_port = tcp:getsockname().port
tcp:close()
viewer.setup({
  preview = { auto_start = true, auto_close = true, combine = false },
  server = { port = configured_port },
})
local e = dir .. "/e.md"
local f = dir .. "/f.md"
vim.fn.writefile({ "# E" }, e)
vim.fn.writefile({ "# F" }, f)
vim.cmd("edit " .. vim.fn.fnameescape(e))
vim.bo.filetype = "markdown"
vim.cmd("MarkdownPreview")
vim.cmd("split " .. vim.fn.fnameescape(f))
vim.bo.filetype = "markdown"
vim.cmd("MarkdownPreview")
wait_open(2)
local urls = {}
for _, row in pairs(session.rows()) do
  urls[#urls + 1] = row.url
end
if #urls ~= 2 or urls[1] == urls[2] then
  fail("two sibling rows did not get two addresses")
end
local held = false
local ephemeral = false
for _, url in ipairs(urls) do
  if url:match(":(%d+)") == tostring(configured_port) then
    held = true
  else
    ephemeral = true
  end
end
if not held or not ephemeral then
  fail("port rule did not give the configured port to one row and 0 to the other")
end
out("REAL nvim port rule")

for _, bufnr in ipairs(vim.tbl_keys(session.rows())) do
  session.stop(bufnr)
end
vim.wait(5000, function()
  return row_count() == 0
end, 50)

local g = dir .. "/g.md"
vim.fn.writefile({ "# G" }, g)
vim.cmd("edit " .. vim.fn.fnameescape(g))
vim.bo.filetype = "markdown"
vim.cmd("MarkdownPreview")
wait_open(1)
local regranted = nil
for _, row in pairs(session.rows()) do
  regranted = row.url
end
if regranted == nil or regranted:match(":(%d+)") ~= tostring(configured_port) then
  fail("configured port was not free again after every row ended")
end
out("REAL nvim port free after stop")

vim.cmd("MarkdownPreviewStop")
vim.wait(5000, function()
  return row_count() == 0
end, 50)

if #opened < 2 then
  fail("expected two opened pages, got " .. #opened)
end
out("OK editor:sessions (nvim, REAL, " .. #opened .. " pages)")

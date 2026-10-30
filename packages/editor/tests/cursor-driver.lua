-- One headless Neovim run of the cursor case file through the session handle.
-- Run with: nvim --headless -u NONE -l packages/editor/tests/cursor-driver.lua
local source = debug.getinfo(1, "S").source:sub(2)
local root = vim.fn.fnamemodify(source, ":p:h:h:h:h")
local lua_dir = root .. "/packages/editor/nvim/lua"
package.path = lua_dir .. "/?.lua;" .. lua_dir .. "/?/init.lua;" .. package.path

local function out(line)
  io.stdout:write(line .. "\n")
  io.stdout:flush()
end

local function fail(message)
  out("FAIL editor:cursors: " .. message)
  os.exit(1)
end

local session = require("markdown_viewer.session")
local codec = require("markdown_viewer.generated.codec")
local replay = dofile(root .. "/packages/editor/tests/cursor-replay.lua")

local text = io.open(root .. "/packages/editor/tests/cursor-cases.json", "rb")
if text == nil then
  fail("no cursor-cases.json")
end
local suite = vim.json.decode(text:read("*a"))
text:close()

for _, case in ipairs(suite.cases) do
  local ok, why = replay.run(case, session, codec)
  if not ok then
    fail(case.name .. ": " .. why)
  end
  out("OK cursor " .. case.name)
end

for _, case in ipairs(suite.fractions) do
  local actual = session.cursor_fraction(case.winline, case.winheight)
  if math.abs(actual - case.fraction) > 1e-9 then
    fail("fraction " .. case.winline .. "/" .. case.winheight .. " differs")
  end
end
out("OK editor:cursors (nvim, " .. #suite.cases .. " cases)")

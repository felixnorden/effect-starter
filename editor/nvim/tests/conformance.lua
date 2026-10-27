-- The recorded Neovim conformance run: decode every committed golden frame
-- with the real generated codec, then run the shared discovery cases.
-- Run with: nvim --headless -u NONE -l editor/nvim/tests/conformance.lua
local source = debug.getinfo(1, "S").source:sub(2)
local root = vim.fn.fnamemodify(source, ":p:h:h:h:h")
local lua_dir = root .. "/editor/nvim/lua"
package.path = lua_dir .. "/?.lua;" .. lua_dir .. "/?/init.lua;" .. package.path

local frames_dir = root .. "/fixtures/generated/editor-frames"

local function out(line)
  io.stdout:write(line .. "\n")
  io.stdout:flush()
end

local function fail(message)
  out("FAIL neovim conformance: " .. message)
  os.exit(1)
end

local function read_file(path)
  local file = io.open(path, "rb")
  if file == nil then
    return nil
  end
  local contents = file:read("*a")
  file:close()
  return contents
end

local function equal(left, right)
  if type(left) ~= type(right) then
    return false
  end
  if type(left) ~= "table" then
    return left == right
  end
  for key, value in pairs(left) do
    if not equal(value, right[key]) then
      return false
    end
  end
  for key in pairs(right) do
    if left[key] == nil then
      return false
    end
  end
  return true
end

local loaded, codec = pcall(require, "markdown_viewer.generated.codec")
if not loaded then
  fail("generated codec does not load: " .. tostring(codec))
end
local discovery = require("markdown_viewer.discovery")

local manifest_text = read_file(frames_dir .. "/cases.json")
if manifest_text == nil then
  fail("no golden manifest; run bun run frames:generate")
end
local manifest = vim.json.decode(manifest_text)

for _, case in ipairs(manifest.cases) do
  local frame = read_file(frames_dir .. "/" .. case.file)
  if frame == nil then
    fail("missing golden frame " .. case.file)
  end
  local message, failure = codec.decode_frame(frame)
  if message == nil then
    fail("frame " .. case.name .. ": " .. tostring(failure and failure.detail))
  end
  if not equal(message, case.message) then
    fail("frame " .. case.name .. ": decoded value differs")
  end
end

local cases_text = read_file(root .. "/editor/tests/discovery-cases.json")
if cases_text == nil then
  fail("missing editor/tests/discovery-cases.json")
end
local discovered = vim.json.decode(cases_text).cases

for _, case in ipairs(discovered) do
  local existing = {}
  for _, path in ipairs(case.existing) do
    existing[path] = true
  end

  local found = discovery.find({
    configured = case.configured,
    plugin_dir = case.plugin_dir,
    os = case.os,
    arch = case.arch,
    exists = function(path)
      return existing[path] == true
    end,
    realpath = function(path)
      return (case.realpath and case.realpath[path]) or path
    end,
  })

  if found.ok ~= case.expect.ok then
    fail("discovery " .. case.name .. ": ok differs")
  end
  if found.ok then
    if found.command ~= case.expect.command then
      fail("discovery " .. case.name .. ": command differs")
    end
    if not equal(found.args, case.expect.args) then
      fail("discovery " .. case.name .. ": args differ")
    end
  else
    for _, needle in ipairs(case.expect.contains) do
      if not string.find(found.message, needle, 1, true) then
        fail("discovery " .. case.name .. ": message misses " .. needle)
      end
    end
  end
end

out(
  string.format(
    "OK neovim conformance (%d frames, %d discovery cases)",
    #manifest.cases,
    #discovered
  )
)

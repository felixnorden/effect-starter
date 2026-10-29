-- The recorded Neovim conformance run: decode every committed golden frame
-- with the real generated codec, then run the shared discovery cases.
-- Run with: nvim --headless -u NONE -l packages/editor/nvim/tests/conformance.lua
local source = debug.getinfo(1, "S").source:sub(2)
local root = vim.fn.fnamemodify(source, ":p:h:h:h:h:h")
local lua_dir = root .. "/packages/editor/nvim/lua"
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

local cases_text = read_file(root .. "/packages/editor/tests/discovery-cases.json")
if cases_text == nil then
  fail("missing packages/editor/tests/discovery-cases.json")
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

local refresh = require("markdown_viewer.refresh")
local refresh_text = read_file(root .. "/packages/editor/tests/refresh-cases.json")
if refresh_text == nil then
  fail("missing packages/editor/tests/refresh-cases.json")
end
local function denull(value)
  if value == vim.NIL then
    return nil
  end
  if type(value) == "table" then
    for key, entry in pairs(value) do
      value[key] = denull(entry)
    end
  end
  return value
end

local refresh_suite = denull(vim.json.decode(refresh_text))

local function replay_refresh(case)
  local clock = 0
  local timers = {}
  local timer_seq = 0
  local sends = {}
  local attempts = 0
  local delays = {}
  local step_read = case.bind

  local function fake_read(bufnr)
    if step_read == nil then
      return nil
    end
    if bufnr == nil or bufnr == step_read.bufnr then
      return step_read
    end
    return nil
  end

  local function fake_send(path, text)
    attempts = attempts + 1
    local accepted = true
    if case.sendAnswers ~= nil and case.sendAnswers[attempts] ~= nil then
      accepted = case.sendAnswers[attempts]
    end
    if accepted then
      sends[#sends + 1] = { path = path, text = text }
    end
    return accepted
  end

  local function fake_now()
    return clock
  end

  local timer = {
    schedule = function(ms, fn)
      timer_seq = timer_seq + 1
      delays[#delays + 1] = ms
      timers[#timers + 1] = {
        handle = timer_seq,
        due = clock + ms,
        fn = fn,
        fired = false,
        cancelled = false,
      }
      return timer_seq
    end,
    cancel = function(handle)
      for _, entry in ipairs(timers) do
        if entry.handle == handle then
          entry.cancelled = true
        end
      end
    end,
  }

  local handle = refresh.new({
    read = fake_read,
    send = fake_send,
    now = fake_now,
    timer = timer,
  })

  -- Due timers fire before an event at or past their due time, in due order.
  local function fire_due(limit)
    while true do
      local best = nil
      for _, entry in ipairs(timers) do
        if not entry.fired and not entry.cancelled and entry.due <= limit then
          if
            best == nil
            or entry.due < best.due
            or (entry.due == best.due and entry.handle < best.handle)
          then
            best = entry
          end
        end
      end
      if best == nil then
        return
      end
      best.fired = true
      clock = best.due
      best.fn()
    end
  end

  for _, event in ipairs(case.events) do
    clock = event.atMs
    fire_due(clock)
    if event.kind == "Elapsed" then
      -- The clock advanced and due timers fired.
    elseif event.kind == "Stop" then
      handle.stop()
      if handle.bound() ~= nil then
        fail("refresh " .. case.name .. ": stop left the module bound")
      end
    elseif event.kind == "Manual" then
      step_read = event.read
      handle.manual()
    else
      step_read = event.read
      local subject = event.buf
      if subject == nil and event.read ~= nil then
        subject = event.read.bufnr
      end
      if subject == nil and case.bind ~= nil then
        subject = case.bind.bufnr
      end
      handle.on(event.kind, subject)
    end
  end

  local message = "refresh " .. case.name .. ": "
  for _, entry in ipairs(timers) do
    if not entry.fired and not entry.cancelled then
      handle.stop()
      fail(message .. "a live timer remains")
    end
  end
  for _, delay in ipairs(delays) do
    if delay ~= refresh_suite.windowMs then
      handle.stop()
      fail(message .. "timer delay " .. tostring(delay) .. " differs from windowMs")
    end
  end
  if attempts == 0 and #delays ~= 0 then
    handle.stop()
    fail(message .. "opened a window without an accepted send")
  end
  if case.expect.schedules ~= nil and #delays ~= case.expect.schedules then
    handle.stop()
    fail(message .. "schedules " .. #delays .. ", expected " .. case.expect.schedules)
  end
  if attempts ~= case.expect.attempts then
    handle.stop()
    fail(message .. "attempts " .. attempts .. ", expected " .. case.expect.attempts)
  end
  if #sends ~= #case.expect.sends then
    handle.stop()
    fail(message .. "sends " .. #sends .. ", expected " .. #case.expect.sends)
  end
  for index, send in ipairs(case.expect.sends) do
    local actual = sends[index]
    if actual == nil or actual.path ~= send.path or actual.text ~= send.text then
      handle.stop()
      fail(message .. "send " .. index .. " differs")
    end
  end
  handle.stop()
end

for _, case in ipairs(refresh_suite.cases) do
  replay_refresh(case)
end

out(
  string.format(
    "OK neovim conformance (%d frames, %d discovery cases, %d refresh cases)",
    #manifest.cases,
    #discovered,
    #refresh_suite.cases
  )
)

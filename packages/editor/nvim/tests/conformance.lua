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

local config_table = require("markdown_viewer.generated.config")
local config_module = require("markdown_viewer.config")
local viewer = require("markdown_viewer")

local config_text = read_file(root .. "/packages/editor/tests/config-cases.json")
if config_text == nil then
  fail("missing packages/editor/tests/config-cases.json")
end
local config_suite = denull(vim.json.decode(config_text))

local function contains(list, value)
  for _, item in ipairs(list) do
    if item == value then
      return true
    end
  end
  return false
end

local function reset_carriers()
  for _, key in ipairs(config_table.keys) do
    vim.g[string.sub(key.vim_name, 3)] = nil
    if key.alias ~= nil and key.alias_scope == "global" then
      vim.g["mkdp_" .. key.alias] = nil
    end
  end
  vim.g["mkdp_preview_options"] = nil
end

local function apply_carriers(shared, extra)
  for name, value in pairs(shared or {}) do
    vim.g[name] = value
  end
  for name, value in pairs(extra or {}) do
    vim.g[name] = value
  end
end

local function replay_config(case)
  if case.editors ~= nil and not contains(case.editors, "nvim") then
    out("SKIP config " .. case.name .. ": not for nvim")
    return false
  end

  reset_carriers()
  apply_carriers(case.settings.g, case.settings.nvim and case.settings.nvim.g)
  local setup_table = (case.settings.nvim and case.settings.nvim.setup) or {}
  local notified = {}
  local deps = {
    notify = function(text)
      table.insert(notified, text)
    end,
    warned = {},
    g = function(name)
      return vim.g[name]
    end,
  }

  viewer.setup(setup_table, deps)
  viewer.get()
  viewer.setup(setup_table, deps)
  local normalized = viewer.get()

  local expected_values = case.expect.values or {}
  for name, value in pairs(expected_values) do
    if not equal(normalized.values[name], value) then
      fail("config " .. case.name .. ": value " .. name .. " differs")
    end
  end

  local expected_sources = case.expect.sources or {}
  if expected_sources.nvim ~= nil then
    expected_sources = expected_sources.nvim
  end
  for name, source in pairs(expected_sources) do
    if normalized.sources[name] ~= source then
      fail(
        "config "
          .. case.name
          .. ": source "
          .. name
          .. " is "
          .. tostring(normalized.sources[name])
      )
    end
  end

  for _, key in ipairs(config_table.keys) do
    if not key.container and expected_values[key.name] == nil then
      if not equal(normalized.values[key.name], key.default) then
        fail("config " .. case.name .. ": default " .. key.name .. " differs")
      end
      if normalized.sources[key.name] ~= "default" then
        fail("config " .. case.name .. ": default source " .. key.name .. " differs")
      end
    end
  end

  for _, name in ipairs(case.expect.noValue or {}) do
    if normalized.values[name] ~= nil or normalized.sources[name] ~= nil then
      fail("config " .. case.name .. ": " .. name .. " carries a value")
    end
  end

  local expected_warnings = case.expect.warnings or 0
  if #notified ~= expected_warnings then
    fail(
      "config "
        .. case.name
        .. ": warnings "
        .. #notified
        .. ", expected "
        .. expected_warnings
    )
  end

  if case.expect.message ~= nil then
    local found = false
    for _, message in ipairs(notified) do
      if message == case.expect.message then
        found = true
        break
      end
    end
    if not found then
      fail("config " .. case.name .. ": the four-field message differs")
    end
  end

  if case.expect.messageContains ~= nil then
    local matched = false
    for _, message in ipairs(notified) do
      local all = true
      for _, needle in ipairs(case.expect.messageContains) do
        if not string.find(message, needle, 1, true) then
          all = false
          break
        end
      end
      if all then
        matched = true
        break
      end
    end
    if not matched then
      fail("config " .. case.name .. ": no message names every expected field")
    end
  end

  local groups = config_module.split(normalized)
  for _, key in ipairs(config_table.keys) do
    if not key.container then
      local group = key.class == "page-display" and "display" or key.class
      if groups[group] == nil then
        fail("config " .. case.name .. ": no group " .. tostring(group))
      end
      if not equal(groups[group][key.name], normalized.values[key.name]) then
        fail("config " .. case.name .. ": group " .. group .. " misses " .. key.name)
      end
    end
  end

  local frame_index = 1
  for _, key in ipairs(config_table.keys) do
    if not key.container and (key.class == "render" or key.class == "page-display") then
      local value = normalized.values[key.name]
      local source = normalized.sources[key.name]
      if source ~= "default" and value ~= nil then
        local entry = groups.frame[frame_index]
        if
          entry == nil
          or entry.key ~= key.name
          or entry.source ~= source
          or not equal(entry.value, value)
        then
          fail("config " .. case.name .. ": frame entry " .. key.name .. " differs")
        end
        frame_index = frame_index + 1
      end
    end
  end
  if #groups.frame ~= frame_index - 1 then
    fail("config " .. case.name .. ": frame has extra entries")
  end

  if #config_module.hash(normalized) ~= 64 then
    fail("config " .. case.name .. ": hash is not sha256")
  end

  viewer.setup({}, deps)
  return true
end

local config_ran = 0
for _, case in ipairs(config_suite.cases) do
  if replay_config(case) then
    config_ran = config_ran + 1
    out("OK config " .. case.name)
  end
end

local load_text = read_file(root .. "/packages/editor/tests/load-cases.json")
if load_text == nil then
  fail("missing packages/editor/tests/load-cases.json")
end
local load_suite = denull(vim.json.decode(load_text))

local plugin_path = root .. "/packages/editor/nvim/plugin/markdown_viewer.lua"
local plugin_dir = root .. "/packages/editor/nvim"
local plug_names = {
  "<Plug>(MarkdownPreview)",
  "<Plug>(MarkdownPreviewStop)",
  "<Plug>(MarkdownPreviewToggle)",
}

local function reset_plugin()
  vim.g.loaded_markdown_viewer = nil
  pcall(vim.api.nvim_del_augroup_by_name, "markdown_viewer_filetype")
  for _, name in ipairs({ "MarkdownPreview", "MarkdownPreviewStop", "MarkdownPreviewToggle" }) do
    pcall(vim.api.nvim_del_user_command, name)
  end
  for _, name in ipairs(plug_names) do
    for _, mode in ipairs({ "n", "i" }) do
      pcall(vim.keymap.del, mode, name)
    end
  end
  vim.g.markdown_viewer_filetypes = nil
  vim.g.markdown_viewer_command_for_global = nil
  vim.g.mkdp_filetypes = nil
  vim.g.mkdp_command_for_global = nil
end

local load_deps = {
  notify = function() end,
  warned = {},
  g = function(name)
    return vim.g[name]
  end,
}

local function load_plugin()
  viewer.setup({}, load_deps)
  vim.cmd("source " .. vim.fn.fnameescape(plugin_path))
end

local function commands_exist()
  return vim.fn.exists(":MarkdownPreview") == 2
end

local function maps_exist()
  for _, name in ipairs(plug_names) do
    for _, mode in ipairs({ "n", "i" }) do
      if vim.fn.maparg(name, mode) == "" then
        return false
      end
    end
  end
  return true
end

local function replay_load(case)
  if case.editors ~= nil and not contains(case.editors, "nvim") then
    out("SKIP load " .. case.name .. ": not for nvim")
    return false
  end

  reset_plugin()

  if case.expect.conflict == true then
    local temp = vim.fn.tempname()
    vim.fn.mkdir(temp .. "/plugin", "p")
    vim.fn.writefile({ '" baseline plugin' }, temp .. "/plugin/mkdp.vim")
    local saved = vim.o.runtimepath
    vim.o.runtimepath = temp .. "," .. saved
    local messages = {}
    local original = vim.notify
    vim.notify = function(text)
      table.insert(messages, text)
    end
    load_plugin()
    vim.notify = original
    vim.o.runtimepath = saved
    vim.fn.delete(temp, "rf")

    local found = false
    for _, message in ipairs(messages) do
      if
        string.find(message, temp, 1, true) ~= nil
        and string.find(message, plugin_dir, 1, true) ~= nil
      then
        found = true
      end
    end
    if not found then
      fail("load " .. case.name .. ": no message names both directories")
    end
    if commands_exist() then
      fail("load " .. case.name .. ": commands exist after the conflict")
    end
    out("OK load " .. case.name)
    return true
  end

  if case.expect.floor == true then
    out("SKIP load " .. case.name .. ": the Vim floor message has no Neovim form")
    return false
  end

  vim.g.markdown_viewer_filetypes = case.filetypes or { "markdown" }
  vim.g.markdown_viewer_command_for_global = case.global == true
  vim.cmd("enew")
  vim.bo.filetype = case.filetype
  load_plugin()
  vim.cmd("doautocmd FileType")

  if commands_exist() ~= (case.expect.commands == true) then
    fail("load " .. case.name .. ": commands differ")
  end
  if maps_exist() ~= (case.expect.maps == true) and case.expect.maps ~= nil then
    fail("load " .. case.name .. ": maps differ")
  end

  if case.expect.staleCommands == true then
    vim.g.markdown_viewer_filetypes = { "text" }
    if not commands_exist() then
      fail("load " .. case.name .. ": the old buffer lost its commands")
    end
    vim.cmd("enew")
    vim.bo.filetype = "markdown"
    if commands_exist() then
      fail("load " .. case.name .. ": a new buffer gained commands")
    end
  end

  out("OK load " .. case.name)
  return true
end

local load_ran = 0
for _, case in ipairs(load_suite.cases) do
  if replay_load(case) then
    load_ran = load_ran + 1
  end
end

out(
  string.format(
    "OK neovim conformance (%d frames, %d discovery cases, %d refresh cases, %d config cases, %d load cases)",
    #manifest.cases,
    #discovered,
    #refresh_suite.cases,
    config_ran,
    load_ran
  )
)

local session_module = require("markdown_viewer.session")
local session_text = read_file(root .. "/packages/editor/tests/session-cases.json")
if session_text == nil then
  fail("missing packages/editor/tests/session-cases.json")
end
local session_suite = denull(vim.json.decode(session_text))

local function normalize_with(overrides)
  local result = { values = {}, sources = {} }
  for _, key in ipairs(config_table.keys) do
    result.values[key.name] = key.default
    result.sources[key.name] = "default"
  end
  for name, cell in pairs(overrides or {}) do
    result.values[name] = cell.value
    result.sources[name] = cell.source
  end
  return result
end

local function replay_session(case)
  local overrides = {}
  local buffers = {}
  local jobs = {}
  local sends = {}
  local opened = 0
  local closed = 0
  local configurations = 0
  local notifications = {}
  local autocmds = {}
  local commands = {}
  local next_job = 0

  local function buffer(buf)
    local held = buffers[buf]
    if held == nil then
      held = { bufnr = buf, path = "/tmp/" .. buf .. ".md", text = "# B" .. buf .. "\n" }
      buffers[buf] = held
    end
    return held
  end

  local effects = {
    notify = function(text)
      notifications[#notifications + 1] = text
    end,
    jobstart = function(cmd, opts)
      next_job = next_job + 1
      jobs[next_job] = { opts = opts }
      commands[next_job] = cmd
      sends[tostring(next_job)] = {}
      if case.ready ~= false then
        local ready = codec.encode_frame({
          _tag = "ready",
          editorProtocolVersion = codec.editor_protocol_version,
          sessionId = "session",
          url = "http://127.0.0.1:1/",
        })
        opts.on_stdout(nil, { ready, "" })
      end
      return next_job
    end,
    send = function(job, frame)
      local message = codec.decode_frame(frame)
      if message == nil then
        return false
      end
      sends[tostring(job)][#sends[tostring(job)] + 1] = message._tag
      if message._tag == "configuration" then
        configurations = configurations + 1
      end
      return true
    end,
    close_stdin = function()
      closed = closed + 1
    end,
    jobstop = function() end,
    open = function()
      opened = opened + 1
    end,
    open_named = function()
      opened = opened + 1
    end,
    call_function = function()
      opened = opened + 1
    end,
    defer = function(fn)
      fn()
    end,
    timer_start = function()
      return 1
    end,
    timer_stop = function() end,
    now = function()
      return 0
    end,
    create_group = function(name)
      return name
    end,
    create_autocmd = function(event, opts)
      autocmds[event] = autocmds[event] or {}
      table.insert(autocmds[event], opts)
    end,
    current_buf = function()
      return 1
    end,
    buf_name = function(buf)
      return buffer(buf).path
    end,
    buf_lines = function(buf)
      return vim.split(buffer(buf).text, "\n")
    end,
    buf_valid = function(buf)
      return buffers[buf] ~= nil or buf <= 3
    end,
    cursor = function()
      return { line = 1, fraction = 0 }
    end,
    loaded_bufs = function()
      local loaded = {}
      for bufnr in pairs(buffers) do
        loaded[#loaded + 1] = bufnr
      end
      return loaded
    end,
    log_path = function()
      return "/tmp/markdown-viewer.log"
    end,
    normalize = function()
      return normalize_with(overrides)
    end,
    discovery = function()
      return { ok = true, command = "bun", args = {} }
    end,
  }

  local handle = session_module.new(effects)

  for _, event in ipairs(case.events) do
    if event._tag == "start" then
      buffers[event.buf] = { bufnr = event.buf, path = event.path, text = event.text }
      handle.preview(event.buf)
    elseif event._tag == "stop" then
      handle.stop(event.buf)
    elseif event._tag == "hidden" then
      for _, opts in ipairs(autocmds.BufHidden or {}) do
        if opts.buffer == event.buf then
          opts.callback()
        end
      end
    elseif event._tag == "exit" then
      jobs[event.job].opts.on_exit(nil, event.code)
    elseif event._tag == "auto" then
      buffers[event.buf] = { bufnr = event.buf, path = event.path, text = event.text }
      handle.auto_start(event.buf)
    elseif event._tag == "load" then
      buffers[event.buf] = { bufnr = event.buf, path = event.path, text = event.text }
    elseif event._tag == "enter" then
      handle.enter(event.buf)
    elseif event._tag == "unload" then
      buffers[event.buf] = nil
    elseif event._tag == "text" then
      buffer(event.buf).text = event.text
    elseif event._tag == "preview" then
      handle.preview(event.buf)
    elseif event._tag == "stop_all" then
      handle.stop_all()
    elseif event._tag == "config" then
      for name, cell in pairs(event.values) do
        overrides[name] = cell
      end
      handle.config_changed()
    end
  end

  local rows = {}
  for bufnr in pairs(handle.rows()) do
    rows[#rows + 1] = bufnr
  end
  table.sort(rows)
  local expect = case.expect
  if not equal(rows, expect.rows) then
    fail("session " .. case.name .. ": rows differ")
  end
  if opened ~= expect.opened or closed ~= expect.closed then
    fail("session " .. case.name .. ": open/close counts differ")
  end
  if expect.configurations ~= nil and configurations ~= expect.configurations then
    fail("session " .. case.name .. ": configuration count differs")
  end
  if expect.sends ~= nil then
    for job, tags in pairs(expect.sends) do
      if not equal(sends[job], tags) then
        fail("session " .. case.name .. ": job " .. job .. " sends differ")
      end
    end
  end
  if expect.jobs ~= nil and next_job ~= expect.jobs then
    fail("session " .. case.name .. ": job count differs")
  end
  if expect.ports ~= nil then
    for job, port in pairs(expect.ports) do
      local cmd = commands[tonumber(job)]
      local found = nil
      for index, arg in ipairs(cmd or {}) do
        if arg == "--port" then
          found = cmd[index + 1]
        end
      end
      if found ~= port then
        fail("session " .. case.name .. ": port " .. job .. " differs")
      end
    end
  end
  if expect.notifications ~= nil then
    local joined = table.concat(notifications, "\n")
    for _, needle in ipairs(expect.notifications) do
      if not string.find(joined, needle, 1, true) then
        fail("session " .. case.name .. ": no notification names " .. needle)
      end
    end
  end
end

for _, case in ipairs(session_suite.cases) do
  replay_session(case)
  out("OK session " .. case.name)
end

local opener_text = read_file(root .. "/packages/editor/tests/opener-cases.json")
if opener_text == nil then
  fail("missing packages/editor/tests/opener-cases.json")
end
local opener_suite = denull(vim.json.decode(opener_text))
for _, case in ipairs(opener_suite.cases) do
  replay_session(case)
  out("OK opener " .. case.name)
end

local cursor_replay = dofile(root .. "/packages/editor/tests/cursor-replay.lua")
local cursor_text = read_file(root .. "/packages/editor/tests/cursor-cases.json")
if cursor_text == nil then
  fail("missing packages/editor/tests/cursor-cases.json")
end
local cursor_suite = denull(vim.json.decode(cursor_text))
for _, case in ipairs(cursor_suite.cases) do
  local ok, why = cursor_replay.run(case, session_module, codec)
  if not ok then
    fail("cursor " .. case.name .. ": " .. tostring(why))
  end
  out("OK cursor " .. case.name)
end
for _, case in ipairs(cursor_suite.fractions) do
  local actual = session_module.cursor_fraction(case.winline, case.winheight)
  if math.abs(actual - case.fraction) > 1e-9 then
    fail("fraction " .. case.winline .. "/" .. case.winheight .. " differs")
  end
end
out("OK cursor fractions")

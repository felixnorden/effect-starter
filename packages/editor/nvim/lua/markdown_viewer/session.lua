local codec = require("markdown_viewer.generated.codec")
local config = require("markdown_viewer.config")
local config_table = require("markdown_viewer.generated.config")
local discovery = require("markdown_viewer.discovery")
local frames = require("markdown_viewer.frames")
local messages = require("markdown_viewer.messages")

local M = {}

-- Spawn to ready. The measured warm ready is ~1.45 s, dominated by the
-- server's first render; this is the timeout, not the budget.
local START_TIMEOUT_MS = 5000
local EXIT_GRACE_MS = 500
local ROW_GROUP = "markdown_viewer_rows"

local function default_effects()
  return {
    notify = function(text)
      vim.notify(text, vim.log.levels.ERROR)
    end,
    jobstart = function(cmd, opts)
      return vim.fn.jobstart(cmd, opts)
    end,
    send = frames.send,
    close_stdin = frames.close_stdin,
    jobstop = function(job)
      pcall(vim.fn.jobstop, job)
    end,
    open = function(url)
      vim.ui.open(url)
    end,
    open_named = function(name, url)
      local cmd
      if vim.fn.has("macunix") == 1 then
        cmd = { "open", "-a", name, url }
      elseif vim.fn.has("win32") == 1 then
        cmd = { "cmd", "/c", "start", "", name, url }
      else
        cmd = { name, url }
      end
      vim.fn.jobstart(cmd, { detach = true })
    end,
    call_function = function(name, url)
      local fn = vim.fn[name]
      if type(fn) == "function" then
        return fn(url)
      end
      local global = _G[name]
      if type(global) == "function" then
        return global(url)
      end
      return nil
    end,
    defer = function(fn, ms)
      vim.defer_fn(fn, ms)
    end,
    timer_start = function(ms, fn)
      return vim.fn.timer_start(ms, fn)
    end,
    timer_stop = function(handle)
      pcall(vim.fn.timer_stop, handle)
    end,
    now = function()
      return vim.uv.now()
    end,
    create_group = function(name)
      return vim.api.nvim_create_augroup(name, { clear = true })
    end,
    create_autocmd = function(event, opts)
      return vim.api.nvim_create_autocmd(event, opts)
    end,
    current_buf = function()
      return vim.api.nvim_get_current_buf()
    end,
    cursor = function()
      local win = vim.api.nvim_get_current_win()
      local height = vim.api.nvim_win_get_height(win)
      return {
        line = vim.api.nvim_win_get_cursor(win)[1],
        fraction = M.cursor_fraction(vim.fn.winline(), height),
      }
    end,
    buf_name = function(buf)
      return vim.api.nvim_buf_get_name(buf)
    end,
    buf_lines = function(buf)
      return vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    end,
    buf_valid = function(buf)
      return vim.api.nvim_buf_is_valid(buf)
    end,
    loaded_bufs = function()
      local result = {}
      for _, info in ipairs(vim.fn.getbufinfo({ bufloaded = 1 })) do
        result[#result + 1] = info.bufnr
      end
      return result
    end,
    log_path = function()
      local dir = vim.fn.stdpath("cache") .. "/markdown-viewer"
      vim.fn.mkdir(dir, "p")
      return string.format("%s/%d-%d.log", dir, vim.fn.getpid(), os.time())
    end,
    normalize = function()
      return require("markdown_viewer").refresh()
    end,
    discovery = discovery.find,
  }
end

--- The in-window position: line 1 at the top is 0; a one-line window is 0.
--- The result is clamped to 0..1 for a line outside the visible window.
function M.cursor_fraction(winline, winheight)
  local fraction = (winline - 1) / math.max(1, winheight - 1)
  return math.max(0, math.min(1, fraction))
end

--- One session handle owns the buffer→row table. Production builds one; the
--- conformance replay builds one over a fake effects record.
function M.new(effects)
  effects = effects or default_effects()
  local rows = {}
  local expected_exit = {}

  local function report(row, text)
    if row.lastReported == text then
      return
    end
    row.lastReported = text
    effects.notify(text)
  end

  local function clear_timer(row)
    if row.timer ~= nil then
      effects.timer_stop(row.timer)
      row.timer = nil
    end
  end

  local function teardown(row, reason)
    if rows[row.bufnr] ~= row then
      return
    end
    rows[row.bufnr] = nil
    if row.refresh ~= nil then
      row.refresh.stop()
    end
    clear_timer(row)
    if row.job ~= nil and not row.exited then
      expected_exit[row.job] = true
      effects.close_stdin(row.job)
      effects.defer(function()
        effects.jobstop(row.job)
      end, EXIT_GRACE_MS)
    end
    if reason ~= nil then
      report(row, reason)
    end
  end

  local function on_error_frame(row, detail, fatal)
    if rows[row.bufnr] ~= row then
      return
    end
    report(row, detail)
    row.fatal = fatal == true
    if row.state == "starting" then
      teardown(row, nil)
    end
  end

  local open_url

  local function on_message(row, message)
    if rows[row.bufnr] ~= row then
      return
    end
    if message._tag == "ready" then
      if row.state ~= "starting" then
        return
      end
      clear_timer(row)
      row.state = "open"
      row.url = message.url
      open_url(row)
      return
    end
    if message._tag == "error" then
      on_error_frame(
        row,
        message.message,
        message.clientVersion ~= nil or message.serverVersion ~= nil
      )
    end
  end

  local function on_exit(row, code)
    row.exited = true
    if row.job ~= nil and expected_exit[row.job] then
      expected_exit[row.job] = nil
      return
    end
    if rows[row.bufnr] ~= row then
      return
    end
    if row.fatal then
      teardown(row, nil)
      return
    end
    report(row, messages.dead_server(row.log, code))
    teardown(row, nil)
  end

  local function read_buffer(bufnr)
    if not effects.buf_valid(bufnr) then
      return nil
    end
    local name = effects.buf_name(bufnr)
    if name == "" then
      return nil
    end
    return {
      bufnr = bufnr,
      path = name,
      text = table.concat(effects.buf_lines(bufnr), "\n") .. "\n",
    }
  end

  local function encode_document(row, read)
    if read.path == "" then
      report(row, messages.unnamed)
      return nil
    end
    if #read.text >= codec.max_frame_bytes then
      report(row, messages.oversize(codec.max_frame_bytes))
      return nil
    end
    local message = {
      _tag = "document",
      editorProtocolVersion = codec.editor_protocol_version,
      path = read.path,
      text = read.text,
    }
    local frame = codec.encode_frame(message)
    if #frame > codec.max_frame_bytes then
      report(row, messages.oversize(codec.max_frame_bytes))
      return nil
    end
    return frame
  end

  --- Only sendable classes, only non-default, non-nil values, declaration order.
  local function configuration_entries(normalized)
    local entries = {}
    for _, key in ipairs(config_table.keys) do
      local class = key.class
      if class == "render" or class == "page-display" then
        local value = normalized.values[key.name]
        local source = normalized.sources[key.name]
        if source ~= "default" and value ~= nil and value ~= vim.NIL then
          entries[#entries + 1] = { key = key.name, value = value, source = source }
        end
      end
    end
    return entries
  end

  local function configuration_frame(row)
    return codec.encode_frame({
      _tag = "configuration",
      editorProtocolVersion = codec.editor_protocol_version,
      values = configuration_entries(row.config),
    })
  end

  local function send_configuration(row)
    if row.job == nil then
      return false
    end
    return effects.send(row.job, configuration_frame(row))
  end

  --- A changed setting applies now when the class is sendable; editor and
  --- endpoint classes report once and wait for the next start (G-42).
  local function sync_configuration(row)
    local normalized = effects.normalize()
    -- Hash the complete sendable set so a removed key also counts as a change.
    local changed = config.hash(normalized) ~= config.hash(row.config)

    for _, key in ipairs(config_table.keys) do
      local class = key.class
      if class == "editor" or class == "endpoint" then
        local current = normalized.values[key.name]
        local before = row.config.values[key.name]
        if
          current ~= nil
          and normalized.sources[key.name] ~= "default"
          and current ~= before
          and current ~= vim.NIL
        then
          local text = string.format(
            "Markdown Viewer: %s applies at the next start.",
            key.name
          )
          if row.reported[key.name] ~= tostring(current) then
            row.reported[key.name] = tostring(current)
            effects.notify(text)
          end
        end
      end
    end

    row.config = normalized
    if not changed then
      return
    end
    if send_configuration(row) then
      row.lastReported = nil
    end
  end

  local function endpoint_refusal(normalized)
    local values = normalized.values
    if values["server.open_to_the_world"] == true then
      return "Markdown Viewer: refusing to open the preview to the world. PT-5 keeps the endpoint on loopback."
    end
    local host = values["server.open_ip"]
    if
      type(host) == "string"
      and host ~= ""
      and host ~= "127.0.0.1"
      and host ~= "localhost"
      and host ~= "::1"
    then
      return string.format(
        "Markdown Viewer: refusing non-loopback host %s. PT-5 keeps the endpoint on loopback.",
        host
      )
    end
    return nil
  end

  open_url = function(row)
    local values = row.config.values
    if values["server.echo_url"] == true then
      effects.notify(row.url)
      return
    end
    local name = values["browser.open_function"]
    if type(name) == "string" and name ~= "" then
      effects.call_function(name, row.url)
      return
    end
    local browser = values["browser.name"]
    if type(browser) == "string" and browser ~= "" then
      effects.open_named(browser, row.url)
      return
    end
    effects.open(row.url)
  end

  local function send_cursor(row)
    if row.job == nil or row.state ~= "open" then
      return false
    end
    local normalized = row.config
    if normalized ~= nil and normalized.values["scroll.enabled"] == false then
      return false
    end
    local position = effects.cursor()
    if position == nil then
      return false
    end
    local frame = codec.encode_frame({
      _tag = "cursor",
      editorProtocolVersion = codec.editor_protocol_version,
      line = position.line,
      fraction = position.fraction,
    })
    return effects.send(row.job, frame)
  end

  local function is_combine(row)
    return row.config ~= nil and row.config.values["preview.combine"] == true
  end

  local function other_member(exclude)
    for _, bufnr in ipairs(effects.loaded_bufs()) do
      if bufnr ~= exclude and read_buffer(bufnr) ~= nil then
        return bufnr
      end
    end
    return nil
  end

  local transmit

  local function make_refresh(row)
    return require("markdown_viewer.refresh").new({
      group = "markdown_viewer_refresh_" .. row.bufnr,
      read = function(subject)
        return read_buffer(subject or row.bufnr)
      end,
      send = function(_, body)
        if rows[row.bufnr] ~= row or row.state ~= "open" then
          return false
        end
        local read = read_buffer(row.bufnr)
        if read == nil then
          return false
        end
        return transmit(row, { path = read.path, text = body })
      end,
      before_send = function()
        sync_configuration(row)
      end,
      send_cursor = function()
        return send_cursor(row)
      end,
      now = effects.now,
      timer = {
        schedule = effects.timer_start,
        cancel = effects.timer_stop,
      },
    })
  end

  transmit = function(row, read)
    local frame = encode_document(row, read)
    if frame == nil then
      return false
    end
    if not effects.send(row.job, frame) then
      report(row, messages.dead_server(row.log, "closed"))
      teardown(row, nil)
      return false
    end
    return true
  end

  local install_row_autocmds

  local function rebind(row, bufnr)
    local read = read_buffer(bufnr)
    if read == nil then
      return false
    end
    local previous = row.bufnr
    rows[previous] = nil
    row.bufnr = bufnr
    rows[bufnr] = row
    row.refresh = make_refresh(row)
    install_row_autocmds(row)
    if is_combine(row) and row.config.values["preview.combine_auto_refresh"] ~= false then
      transmit(row, read)
    end
    row.refresh.rebind()
    return true
  end

  local function close_row(row)
    if rows[row.bufnr] ~= row then
      return
    end
    if is_combine(row) then
      local other = other_member(row.bufnr)
      if other ~= nil then
        rebind(row, other)
        return
      end
    end
    teardown(row, nil)
  end

  install_row_autocmds = function(row)
    local row_group = effects.create_group("markdown_viewer_row_" .. row.bufnr)
    effects.create_autocmd({ "BufDelete", "BufWipeout" }, {
      group = row_group,
      buffer = row.bufnr,
      callback = function()
        local normalized = effects.normalize()
        local setting = normalized and normalized.values and normalized.values["preview.auto_close"]
        if setting ~= false then
          close_row(row)
        end
      end,
    })
    effects.create_autocmd("BufHidden", {
      group = row_group,
      buffer = row.bufnr,
      callback = function()
        local normalized = effects.normalize()
        local setting = normalized and normalized.values and normalized.values["preview.auto_close"]
        if setting ~= false then
          close_row(row)
        end
      end,
    })
  end

  local function combine_row()
    for _, row in pairs(rows) do
      if is_combine(row) then
        return row
      end
    end
    return nil
  end

  local handle = {}

  function handle.enter(bufnr)
    bufnr = bufnr or effects.current_buf()
    if rows[bufnr] ~= nil then
      return
    end
    local row = combine_row()
    if row ~= nil then
      rebind(row, bufnr)
    end
  end

  function handle.preview(bufnr)
    bufnr = bufnr or effects.current_buf()
    local existing = rows[bufnr]
    if existing ~= nil then
      if existing.state == "starting" then
        return
      end
      existing.refresh.manual()
      return
    end

    local joined = combine_row()
    if joined ~= nil then
      rebind(joined, bufnr)
      return
    end

    local read = read_buffer(bufnr)
    if read == nil then
      return
    end
    local normalized = effects.normalize()
    local refused = endpoint_refusal(normalized)
    if refused ~= nil then
      effects.notify(refused)
      return
    end
    local configuredPort = normalized.values["server.port"]
    local port = configuredPort
    if type(configuredPort) == "number" then
      for _, other in pairs(rows) do
        if other ~= nil and other.requestedPort == configuredPort then
          port = 0
        end
      end
    end
    local row = {
      bufnr = bufnr,
      state = "starting",
      job = nil,
      url = nil,
      log = nil,
      lastReported = nil,
      reported = {},
      timer = nil,
      exited = false,
      fatal = false,
      refresh = nil,
      config = normalized,
      requestedPort = port,
    }
    local frame = encode_document(row, read)
    if frame == nil then
      return
    end

    local found = effects.discovery({ configured = vim.g.markdown_viewer_server })
    if not found.ok then
      effects.notify(found.message)
      return
    end

    row.log = effects.log_path()
    local cmd = { found.command }
    vim.list_extend(cmd, found.args)
    vim.list_extend(cmd, { "editor", "--log-file", row.log })
    local host = normalized.values["server.open_ip"]
    if type(host) == "string" and host ~= "" then
      vim.list_extend(cmd, { "--host", host })
    end
    if type(port) == "number" then
      vim.list_extend(cmd, { "--port", tostring(port) })
    end

    rows[bufnr] = row
    local ok, job = pcall(effects.jobstart, cmd, {
      stdin = "pipe",
      stdout_buffered = false,
      on_stdout = frames.handler(
        function(message)
          on_message(row, message)
        end,
        function(failure)
          on_error_frame(row, failure and failure.detail or "Markdown Viewer: unreadable frame.", false)
        end
      ),
      on_exit = function(_, code)
        on_exit(row, code)
      end,
    })
    if not ok or type(job) ~= "number" or job <= 0 then
      rows[bufnr] = nil
      effects.notify(messages.start_failed(row.log))
      return
    end
    row.job = job

    if not send_configuration(row) or not effects.send(job, frame) then
      teardown(row, messages.start_failed(row.log))
      return
    end

    row.refresh = make_refresh(row)
    install_row_autocmds(row)

    row.timer = effects.timer_start(START_TIMEOUT_MS, function()
      if rows[row.bufnr] == row and row.state == "starting" then
        teardown(row, messages.timeout(START_TIMEOUT_MS, row.log))
      end
    end)
  end

  function handle.cursor(bufnr)
    bufnr = bufnr or effects.current_buf()
    local row = rows[bufnr]
    if row == nil then
      return false
    end
    return send_cursor(row)
  end

  function handle.on(kind, bufnr)
    bufnr = bufnr or effects.current_buf()
    local row = rows[bufnr]
    if row ~= nil and row.refresh ~= nil then
      row.refresh.on(kind, bufnr)
    end
  end

  function handle.rebind(bufnr)
    bufnr = bufnr or effects.current_buf()
    local row = rows[bufnr]
    if row ~= nil and row.refresh ~= nil then
      row.refresh.rebind()
    end
  end

  function handle.stop(bufnr)
    bufnr = bufnr or effects.current_buf()
    local row = rows[bufnr]
    if row ~= nil then
      teardown(row, nil)
    end
  end

  function handle.toggle(bufnr)
    bufnr = bufnr or effects.current_buf()
    if rows[bufnr] == nil then
      handle.preview(bufnr)
    else
      teardown(rows[bufnr], nil)
    end
  end

  function handle.auto_start(bufnr)
    local normalized = effects.normalize()
    local setting = normalized and normalized.values and normalized.values["preview.auto_start"]
    if setting == false then
      return
    end
    if rows[bufnr] == nil and read_buffer(bufnr) ~= nil then
      handle.preview(bufnr)
    end
  end

  function handle.config_changed()
    for _, row in pairs(rows) do
      sync_configuration(row)
    end
  end

  function handle.stop_all()
    for _, row in pairs(rows) do
      teardown(row, nil)
    end
  end

  function handle.rows()
    local snapshot = {}
    for bufnr, row in pairs(rows) do
      snapshot[bufnr] = { state = row.state, job = row.job, url = row.url }
    end
    return snapshot
  end

  return handle
end

local default = nil
local function handle()
  if default == nil then
    default = M.new()
    vim.api.nvim_create_augroup(ROW_GROUP, { clear = true })
    vim.api.nvim_create_autocmd("VimLeavePre", {
      group = ROW_GROUP,
      callback = function()
        default.stop_all()
      end,
    })
    vim.api.nvim_create_autocmd("BufEnter", {
      group = ROW_GROUP,
      callback = function(args)
        default.enter(args.buf)
      end,
    })
  end
  return default
end

function M.preview(bufnr)
  handle().preview(bufnr)
end

function M.stop(bufnr)
  handle().stop(bufnr)
end

function M.toggle(bufnr)
  handle().toggle(bufnr)
end

function M.auto_start(bufnr)
  handle().auto_start(bufnr)
end

function M.cursor(bufnr)
  handle().cursor(bufnr)
end

function M.on(kind, bufnr)
  handle().on(kind, bufnr)
end

function M.rebind(bufnr)
  handle().rebind(bufnr)
end

function M.enter(bufnr)
  handle().enter(bufnr)
end

function M.config_changed()
  if default ~= nil then
    default.config_changed()
  end
end

function M.rows()
  if default == nil then
    return {}
  end
  return default.rows()
end

return M

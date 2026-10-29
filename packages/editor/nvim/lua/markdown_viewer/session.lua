local codec = require("markdown_viewer.generated.codec")
local discovery = require("markdown_viewer.discovery")
local frames = require("markdown_viewer.frames")
local messages = require("markdown_viewer.messages")

local M = {}

-- Spawn to ready. The measured warm ready is ~1.45 s, dominated by the
-- server's first render; this is the timeout, not the budget.
local START_TIMEOUT_MS = 5000
local EXIT_GRACE_MS = 500

-- One row per editor: { state, job, url, log, lastReported, timer }.
local row = nil
-- A job whose teardown already ran: its exit reports nothing more.
local expected_exit = {}
local log_counter = 0

local function notify(text)
  vim.notify(text, vim.log.levels.ERROR)
end

local function log_path()
  local dir = vim.fn.stdpath("cache") .. "/markdown-viewer"
  vim.fn.mkdir(dir, "p")
  log_counter = log_counter + 1
  return string.format("%s/%d-%d-%d.log", dir, vim.fn.getpid(), os.time(), log_counter)
end

local function clear_timer(current)
  if current.timer ~= nil then
    pcall(vim.fn.timer_stop, current.timer)
    current.timer = nil
  end
end

--- The one teardown: stop, toggle-at-starting, the start timeout, an error
--- frame while starting, and an unexpected exit all reach it.
local function teardown(current, reason)
  if current ~= row then
    return
  end

  row = nil
  if current.refresh ~= nil then
    current.refresh.stop()
  end
  clear_timer(current)
  if current.job ~= nil and not current.exited then
    expected_exit[current.job] = true
    frames.close_stdin(current.job)
    vim.defer_fn(function()
      pcall(vim.fn.jobstop, current.job)
    end, EXIT_GRACE_MS)
  end

  if reason ~= nil and reason ~= current.lastReported then
    current.lastReported = reason
    notify(reason)
  end
end

local function report(current, text)
  if current.lastReported == text then
    return
  end
  current.lastReported = text
  notify(text)
end

local function on_error_frame(current, detail, fatal)
  if current ~= row then
    return
  end
  if current.lastReported == detail then
    return
  end
  current.lastReported = detail
  current.fatal = fatal == true
  notify(detail)
  -- An error while starting is terminal; one while open keeps the row.
  if current.state == "starting" then
    teardown(current, nil)
  end
end

local function on_frame_error(current, failure)
  on_error_frame(current, failure and failure.detail or "Markdown Viewer: unreadable frame.", false)
end

local function on_message(current, message)
  if current ~= row then
    return
  end

  if message._tag == "ready" then
    if current.state ~= "starting" then
      return
    end
    clear_timer(current)
    current.state = "open"
    current.url = message.url
    vim.ui.open(message.url)
    return
  end

  if message._tag == "error" then
    on_error_frame(
      current,
      message.message,
      message.clientVersion ~= nil or message.serverVersion ~= nil
    )
  end
end

local function on_exit(current, code)
  current.exited = true
  if current.job ~= nil and expected_exit[current.job] then
    expected_exit[current.job] = nil
    return
  end
  if current ~= row then
    return
  end
  if current.fatal then
    teardown(current, nil)
    return
  end
  local message = messages.dead_server(current.log, code)
  if current.lastReported ~= message then
    current.lastReported = message
    notify(message)
  end
  teardown(current, nil)
end

--- The one builder: the text-length lower bound first, then unnamed and cap.
local function encode_document(current, path, text)
  if path == "" then
    report(current, messages.unnamed)
    return nil
  end
  -- The encoded frame contains the text escaped and never shortened.
  if #text >= codec.max_frame_bytes then
    report(current, messages.oversize(codec.max_frame_bytes))
    return nil
  end
  local message = {
    _tag = "document",
    editorProtocolVersion = codec.editor_protocol_version,
    path = path,
    text = text,
  }
  local frame = codec.encode_frame(message)
  if #frame > codec.max_frame_bytes then
    report(current, messages.oversize(codec.max_frame_bytes))
    return nil
  end
  return frame
end

--- The one wire path for a later frame: the manual command and the refresh
--- module both reach it. Returns whether the frame left.
local function transmit(current, path, text)
  local frame = encode_document(current, path, text)
  if frame == nil then
    return false
  end
  if not frames.send(current.job, frame) then
    report(current, messages.dead_server(current.log, "closed"))
    teardown(current, nil)
    return false
  end
  return true
end

--- The refresh module's send: the row must be open (M-5).
local function send_document(current, path, text)
  if current ~= row or current.state ~= "open" then
    return false
  end
  return transmit(current, path, text)
end

local function start()
  local current = {
    state = "starting",
    job = nil,
    url = nil,
    log = nil,
    lastReported = nil,
    timer = nil,
    exited = false,
    fatal = false,
    refresh = nil,
  }
  local bufnr = vim.api.nvim_get_current_buf()
  local path = vim.api.nvim_buf_get_name(bufnr)
  local text = table.concat(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false), "\n") .. "\n"
  local frame = encode_document(current, path, text)
  if frame == nil then
    return
  end

  local found = discovery.find({ configured = vim.g.markdown_viewer_server })
  if not found.ok then
    notify(found.message)
    return
  end

  current.log = log_path()
  local cmd = { found.command }
  vim.list_extend(cmd, found.args)
  vim.list_extend(cmd, { "editor", "--log-file", current.log })

  row = current
  local ok, job = pcall(vim.fn.jobstart, cmd, {
    stdin = "pipe",
    stdout_buffered = false,
    on_stdout = frames.handler(
      function(message)
        on_message(current, message)
      end,
      function(failure)
        on_frame_error(current, failure)
      end
    ),
    on_exit = function(_, code)
      on_exit(current, code)
    end,
  })

  if not ok or type(job) ~= "number" or job <= 0 then
    row = nil
    notify(messages.start_failed(current.log))
    return
  end
  current.job = job

  if not frames.send(job, frame) then
    teardown(current, messages.start_failed(current.log))
    return
  end

  current.refresh = require("markdown_viewer.refresh").new({
    read = function(subject)
      subject = subject or vim.api.nvim_get_current_buf()
      if not vim.api.nvim_buf_is_valid(subject) then
        return nil
      end
      local name = vim.api.nvim_buf_get_name(subject)
      if name == "" then
        return nil
      end
      return {
        bufnr = subject,
        path = name,
        text = table.concat(vim.api.nvim_buf_get_lines(subject, 0, -1, false), "\n") .. "\n",
      }
    end,
    send = function(name, body)
      return send_document(current, name, body)
    end,
    now = function()
      return vim.uv.now()
    end,
    timer = {
      schedule = function(ms, fn)
        return vim.fn.timer_start(ms, fn)
      end,
      cancel = function(handle)
        pcall(vim.fn.timer_stop, handle)
      end,
    },
  })

  local group = vim.api.nvim_create_augroup("markdown_viewer_refresh", { clear = false })
  vim.api.nvim_create_autocmd({ "BufDelete", "BufWipeout" }, {
    group = group,
    callback = function(args)
      if row == nil then
        return
      end
      local bound = row.refresh.bound()
      if bound == nil or args.buf ~= bound then
        return
      end
      M.stop()
    end,
  })
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = group,
    callback = function()
      M.stop()
    end,
  })

  current.timer = vim.fn.timer_start(START_TIMEOUT_MS, function()
    if row == current and current.state == "starting" then
      teardown(current, messages.timeout(START_TIMEOUT_MS, current.log))
    end
  end)
end

function M.preview()
  if row == nil then
    start()
    return
  end
  if row.state == "starting" then
    return
  end
  row.refresh.manual()
end

function M.stop()
  if row ~= nil then
    teardown(row, nil)
  end
end

function M.toggle()
  if row == nil then
    M.preview()
    return
  end
  teardown(row, nil)
end

return M

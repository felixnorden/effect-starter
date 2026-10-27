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

--- The one document builder: unnamed refused, cap refused, otherwise a frame.
local function document_frame(current)
  local bufnr = vim.api.nvim_get_current_buf()
  local path = vim.api.nvim_buf_get_name(bufnr)
  if path == "" then
    report(current, messages.unnamed)
    return nil
  end

  local text = table.concat(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false), "\n") .. "\n"
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
  }
  local frame = document_frame(current)
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

  current.timer = vim.fn.timer_start(START_TIMEOUT_MS, function()
    if row == current and current.state == "starting" then
      teardown(current, messages.timeout(START_TIMEOUT_MS, current.log))
    end
  end)
end

local function refresh(current)
  local frame = document_frame(current)
  if frame == nil then
    return
  end
  if not frames.send(current.job, frame) then
    report(current, messages.dead_server(current.log, "closed"))
    teardown(current, nil)
  end
end

function M.preview()
  if row == nil then
    start()
    return
  end
  if row.state == "starting" then
    return
  end
  refresh(row)
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

-- The cursor case replay shared by the conformance run and the cursor driver.
-- One session handle over a fake effects record; no real editor and no jobs.
local config_table = require("markdown_viewer.generated.config")

local M = {}

function M.run(case, session_module, codec)
  local overrides = {}
  local buffers = {}
  local jobs = {}
  local order = {}
  local cursors = {}
  local notifications = {}
  local autocmds = {}
  local position = { line = 1, fraction = 0 }
  local next_job = 0

  local function buffer(buf)
    local held = buffers[buf]
    if held == nil then
      held = { bufnr = buf, path = "/tmp/" .. buf .. ".md", text = "# B" .. buf .. "\n" }
      buffers[buf] = held
    end
    return held
  end

  local function normalize_with(values)
    local result = { values = {}, sources = {} }
    for _, key in ipairs(config_table.keys) do
      result.values[key.name] = key.default
      result.sources[key.name] = "default"
    end
    for name, cell in pairs(values or {}) do
      result.values[name] = cell.value
      result.sources[name] = cell.source
    end
    return result
  end

  local effects = {
    notify = function(text)
      notifications[#notifications + 1] = text
    end,
    jobstart = function(_, opts)
      next_job = next_job + 1
      jobs[next_job] = { opts = opts }
      local ready = codec.encode_frame({
        _tag = "ready",
        editorProtocolVersion = codec.editor_protocol_version,
        sessionId = "session",
        url = "http://127.0.0.1:1/",
      })
      opts.on_stdout(nil, { ready, "" })
      return next_job
    end,
    send = function(_, frame)
      local message = codec.decode_frame(frame)
      if message == nil or message._tag == "configuration" then
        return true
      end
      order[#order + 1] = message._tag
      if message._tag == "cursor" then
        cursors[#cursors + 1] = { line = message.line, fraction = message.fraction }
      end
      return true
    end,
    close_stdin = function() end,
    jobstop = function() end,
    open = function() end,
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
    cursor = function()
      return { line = position.line, fraction = position.fraction }
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
    elseif event._tag == "cursor" then
      buffer(event.buf).text = event.text or buffer(event.buf).text
      position = { line = event.line or 1, fraction = event.fraction or 0 }
      if event.enabled ~= nil then
        overrides["scroll.enabled"] = {
          value = event.enabled,
          source = "setup:scroll.enabled",
        }
        handle.config_changed()
      end
      handle.on(event.kind or "CursorMoved", event.buf)
    elseif event._tag == "rebind" then
      handle.rebind(event.buf)
    elseif event._tag == "config" then
      for name, cell in pairs(event.values) do
        overrides[name] = cell
      end
      handle.config_changed()
    end
  end

  local expect = case.expect
  if expect.order ~= nil then
    if #order ~= #expect.order then
      return false, "order " .. vim.inspect(order) .. " notes " .. vim.inspect(notifications)
    end
    for index, tag in ipairs(expect.order) do
      if order[index] ~= tag then
        return false, "order " .. vim.inspect(order) .. " notes " .. vim.inspect(notifications)
      end
    end
  end
  if expect.cursors ~= nil and #cursors ~= expect.cursors then
    return false, "cursors " .. #cursors
  end
  if expect.lastCursor ~= nil then
    local last = cursors[#cursors]
    if
      last == nil
      or last.line ~= expect.lastCursor.line
      or math.abs(last.fraction - expect.lastCursor.fraction) > 1e-9
    then
      return false, "last cursor " .. vim.inspect(last)
    end
  end
  if expect.notifications ~= nil then
    local joined = table.concat(notifications, "\n")
    for _, needle in ipairs(expect.notifications) do
      if not string.find(joined, needle, 1, true) then
        return false, "no notification names " .. needle
      end
    end
  end
  return true
end

return M

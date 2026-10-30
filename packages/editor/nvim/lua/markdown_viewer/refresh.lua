local M = {}

local WINDOW_MS = 33
local AUGROUP = "markdown_viewer_refresh"
local COALESCED = {
  CursorHold = true,
  CursorHoldI = true,
  CursorMoved = true,
  CursorMovedI = true,
}

--- @param deps { read: fun(bufnr: integer|nil): {bufnr:integer, path:string, text:string}|nil,
---               send: fun(path:string, text:string): boolean,
---               send_cursor: fun(): boolean,
---               now: fun(): integer,
---               timer: { schedule: fun(ms:integer, fn:fun()): any, cancel: fun(handle:any) } }
function M.new(deps)
  local bound = nil
  local sent = nil
  local pending = nil
  local stopped = false
  local attempt

  local function open_window()
    local due = deps.now() + WINDOW_MS
    local handle = deps.timer.schedule(due - deps.now(), function()
      local window = pending
      pending = nil
      if stopped or window == nil then
        return
      end
      if window.wake then
        attempt(bound, false, window.cursor)
      end
    end)
    -- A nil or non-positive handle means the window cannot open (M-11).
    if handle == nil then
      return
    end
    if type(handle) == "number" and handle <= 0 then
      return
    end
    pending = { handle = handle, wake = false, cursor = false }
  end

  local function coalesce(subject, want_cursor)
    if pending ~= nil then
      pending.wake = true
      pending.cursor = pending.cursor or want_cursor
      return
    end
    if attempt(subject, false, want_cursor) then
      open_window()
    end
  end

  attempt = function(subject, skip_compare, want_cursor)
    local read = deps.read(subject)
    if read == nil then
      return false
    end
    if bound == nil then
      bound = read.bufnr
    end
    if read.bufnr ~= bound then
      return false
    end
    if not skip_compare and read.text == sent then
      if want_cursor and deps.send_cursor ~= nil then
        deps.send_cursor()
      end
      return false
    end
    if deps.send(read.path, read.text) then
      sent = read.text
      if want_cursor and deps.send_cursor ~= nil then
        deps.send_cursor()
      end
      return true
    end
    return false
  end

  local handle = {}

  function handle.on(kind, subject)
    if stopped then
      return
    end
    if deps.before_send ~= nil then
      deps.before_send()
    end
    if COALESCED[kind] then
      coalesce(subject, true)
      return
    end
    if kind == "BufWritePost" or kind == "InsertLeave" then
      attempt(subject, false, false)
    end
  end

  function handle.manual()
    if stopped then
      return
    end
    if deps.before_send ~= nil then
      deps.before_send()
    end
    if pending ~= nil then
      deps.timer.cancel(pending.handle)
      pending = nil
    end
    if bound ~= nil then
      attempt(bound, true, false)
    end
  end

  function handle.rebind()
    if stopped then
      return
    end
    if deps.send_cursor ~= nil then
      deps.send_cursor()
    end
  end

  function handle.stop()
    stopped = true
    if pending ~= nil then
      deps.timer.cancel(pending.handle)
      pending = nil
    end
    bound = nil
    sent = nil
    vim.api.nvim_create_augroup(deps.group or AUGROUP, { clear = true })
  end

  function handle.bound()
    return bound
  end

  -- The first frame already left before this module was built.
  local initial = deps.read(nil)
  if initial ~= nil then
    bound = initial.bufnr
    sent = initial.text
  end

  local group = vim.api.nvim_create_augroup(deps.group or AUGROUP, { clear = true })
  vim.api.nvim_create_autocmd({
    "CursorHold",
    "CursorHoldI",
    "CursorMoved",
    "CursorMovedI",
  }, {
    group = group,
    callback = function(args)
      handle.on(args.event, vim.api.nvim_get_current_buf())
    end,
  })
  vim.api.nvim_create_autocmd({
    "BufWritePost",
    "InsertLeave",
  }, {
    group = group,
    callback = function(args)
      local subject = args.event == "BufWritePost" and args.buf or vim.api.nvim_get_current_buf()
      handle.on(args.event, subject)
    end,
  })

  return handle
end

return M

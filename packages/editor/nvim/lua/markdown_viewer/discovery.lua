local M = {}

local function os_token(uname)
  if uname.sysname == "Darwin" then
    return "darwin"
  end
  if uname.sysname == "Windows_NT" then
    return "win32"
  end
  return "linux"
end

local function arch_token(machine)
  if machine == "x86_64" or machine == "amd64" then
    return "x64"
  end
  if machine == "arm64" or machine == "aarch64" then
    return "arm64"
  end
  return machine
end

local function default_plugin_dir()
  local source = debug.getinfo(1, "S").source:sub(2)
  return vim.fn.fnamemodify(source, ":p:h:h:h")
end

local function default_exists(path)
  return vim.fn.executable(path) == 1 or vim.fn.filereadable(path) == 1
end

local function default_realpath(path)
  return vim.loop.fs_realpath(path) or path
end

--- Resolve one runnable server command from three sources in a fixed order.
--- Returns either `{ ok = true, command, args }` or `{ ok = false, message }`.
function M.find(options)
  options = options or {}
  local exists = options.exists or default_exists
  local realpath = options.realpath or default_realpath
  local uname = vim.loop.os_uname()
  local os = options.os or os_token(uname)
  local arch = options.arch or arch_token(uname.machine)
  local plugin_dir = realpath(options.plugin_dir or default_plugin_dir())
  local attempts = {}

  local configured = options.configured
  if configured == nil then
    configured = vim.g.markdown_viewer_server
  end
  if configured ~= nil and configured ~= "" then
    if exists(configured) then
      return { ok = true, command = configured, args = {} }
    end
    attempts[#attempts + 1] = configured
  end

  local binary = plugin_dir .. "/bin/mdv-" .. os .. "-" .. arch
  if exists(binary) then
    return { ok = true, command = binary, args = {} }
  end
  attempts[#attempts + 1] = binary

  -- A repository checkout: the plugin sits at <root>/editor/nvim.
  local entry = vim.fn.simplify(plugin_dir .. "/../../packages/app/src/main.ts")
  if exists("bun") and exists(entry) then
    return { ok = true, command = "bun", args = { entry } }
  end
  attempts[#attempts + 1] = "bun " .. entry

  return {
    ok = false,
    message = string.format(
      "Markdown Viewer: no server found. Tried %s. Run from a repository checkout with bun installed, or set g:markdown_viewer_server.",
      table.concat(attempts, ", ")
    ),
  }
end

return M

-- The health report: one ordered list, the same eight fields as the Vim module.
-- Values come from discovery, a `version` spawn, the configuration and the
-- session table; a failing field carries its own `fix:` line (Decision H).
local discovery = require("markdown_viewer.discovery")

local M = {}

M.fields = {
  "discovery",
  "server",
  "package",
  "bun",
  "wire",
  "opener",
  "ports",
  "floor",
}

local function split_lines(text)
  local lines = {}
  for line in tostring(text):gmatch("[^\r\n]+") do
    local key, value = line:match("^(%S+)%s+(.+)$")
    if key ~= nil then
      lines[key] = value
    end
  end
  return lines
end

local function server_version(found)
  if not found.ok then
    return nil
  end
  local cmd = { found.command }
  vim.list_extend(cmd, found.args)
  vim.list_extend(cmd, { "version" })
  local ok, output = pcall(vim.fn.system, cmd)
  if not ok then
    return nil
  end
  return split_lines(output)
end

local function opener(values)
  if values["server.echo_url"] == true then
    return "echo"
  end
  local name = values["browser.open_function"]
  if type(name) == "string" and name ~= "" then
    return "function:" .. name
  end
  local browser = values["browser.name"]
  if type(browser) == "string" and browser ~= "" then
    return "named:" .. browser
  end
  return "default"
end

local function ports()
  local open = {}
  for _, row in pairs(require("markdown_viewer.session").rows()) do
    if row.url ~= nil then
      local port = row.url:match(":(%d+)")
      if port ~= nil then
        open[#open + 1] = port
      end
    end
  end
  if #open == 0 then
    return "none"
  end
  table.sort(open)
  return table.concat(open, ",")
end

local function floor()
  local version = vim.version()
  local text = string.format("%d.%d.%d", version.major, version.minor, version.patch)
  if version.major > 0 or version.minor >= 10 then
    return "ok (nvim " .. text .. " >= 0.10.4)"
  end
  return nil, "nvim " .. text .. " is older than 0.10.4"
end

--- The ordered report, as `{ key, value, fix? }` entries.
function M.report(deps)
  deps = deps or {}
  local found = deps.discovery or discovery.find(deps)
  local values = deps.values or require("markdown_viewer").get().values
  local version = deps.version
  if version == nil then
    version = server_version(found)
  end

  local rows = {}
  local function add(key, value, fix)
    rows[#rows + 1] = { key = key, value = value, fix = fix }
  end

  add("discovery", found.ok and "ok" or "missing", found.ok and nil or found.message)

  if found.ok then
    add("server", table.concat(vim.list_extend({ found.command }, found.args), " "))
  else
    add("server", "missing", "install a compiled server or set g:markdown_viewer_server")
  end

  for _, key in ipairs({ "package", "bun", "wire" }) do
    local value = version and version[key] or nil
    if value == nil then
      add(key, "unknown", "run `mdv version` from a repository checkout with bun installed")
    else
      add(key, value)
    end
  end

  add("opener", opener(values))
  add("ports", ports())

  local floor_value, floor_failure = (deps.floor or floor)()
  if floor_value == nil then
    add("floor", floor_failure, "upgrade Neovim to 0.10.4 or newer")
  else
    add("floor", floor_value)
  end

  return rows
end

--- The `:checkhealth markdown-viewer` entry point.
function M.check()
  local start = vim.health.start or vim.health.report_start
  local ok = vim.health.ok or vim.health.report_ok
  local warn = vim.health.warn or vim.health.report_warn
  start("markdown-viewer")
  for _, entry in ipairs(M.report()) do
    if entry.fix == nil then
      ok(entry.key .. ": " .. entry.value)
    else
      warn(entry.key .. ": " .. entry.value .. "\\nfix: " .. entry.fix)
    end
  end
end

return M

-- One generic interpreter of the generated key table. No key name appears here.
local declared = require("markdown_viewer.generated.config")

local M = {}

local function dig(root, dotted)
  local node = root
  for part in string.gmatch(dotted, "[^.]+") do
    if type(node) ~= "table" then
      return nil
    end
    node = node[part]
  end
  return node
end

local function is_array(value)
  if type(value) ~= "table" then
    return false
  end
  local count = 0
  for _ in pairs(value) do
    count = count + 1
  end
  return count == #value
end

local function serialize(value)
  if type(value) == "table" then
    if is_array(value) then
      local parts = {}
      for _, item in ipairs(value) do
        table.insert(parts, serialize(item))
      end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for name in pairs(value) do
      table.insert(keys, name)
    end
    table.sort(keys)
    local parts = {}
    for _, name in ipairs(keys) do
      table.insert(parts, string.format("%q", tostring(name)) .. ":" .. serialize(value[name]))
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  if type(value) == "string" then
    return string.format("%q", value)
  end
  if type(value) == "number" or type(value) == "boolean" then
    return tostring(value)
  end
  return "null"
end

local function received(value)
  if type(value) == "string" then
    return value
  end
  if type(value) == "number" or type(value) == "boolean" then
    return tostring(value)
  end
  if type(value) == "table" then
    return serialize(value)
  end
  return tostring(value)
end

local function expected(key)
  if #key.values > 0 then
    return table.concat(key.values, "|")
  end
  return key.type
end

--- @return { expected: string, received: string }|nil
local function validate(key, value)
  if value == nil then
    return nil
  end

  if #key.values > 0 then
    for _, allowed in ipairs(key.values) do
      if value == allowed then
        return nil
      end
    end
    return { expected = expected(key), received = received(value) }
  end

  local ok = false
  if key.type == "string" then
    ok = type(value) == "string"
  elseif key.type == "number" then
    ok = type(value) == "number"
  elseif key.type == "boolean" then
    ok = type(value) == "boolean"
  elseif key.type == "string-list" then
    ok = is_array(value)
    if ok then
      for _, item in ipairs(value) do
        if type(item) ~= "string" then
          ok = false
          break
        end
      end
    end
  elseif key.type == "json" then
    ok = type(value) == "table" or type(value) == "function"
  end

  if ok then
    return nil
  end
  return { expected = expected(key), received = received(value) }
end

local function report(deps, id, text)
  if deps.warned[id] then
    return
  end
  deps.warned[id] = true
  deps.notify(text)
end

local function variable(name)
  return string.sub(name, 3)
end

local function baseline(key, deps)
  if key.alias == nil then
    return nil, nil
  end

  if key.alias_scope == "global" then
    local name = "mkdp_" .. key.alias
    return deps.g(name), "g:" .. name
  end

  local nested = deps.g("mkdp_preview_options")
  if type(nested) ~= "table" then
    return nil, nil
  end
  return nested[key.alias], "g:mkdp_preview_options." .. key.alias
end

local function normalizer(settings, deps)
  local values = {}
  local sources = {}

  for _, key in ipairs(declared.keys) do
    if not key.container then
      local value, source

      local configured = dig(settings, key.name)
      if configured ~= nil then
        value, source = configured, "setup:" .. key.name
      else
        local direct = deps.g(variable(key.vim_name))
        if direct ~= nil then
          value, source = direct, key.vim_name
        else
          value, source = baseline(key, deps)
        end
      end

      if value ~= nil then
        if key.type == "boolean" and type(value) == "number" and (value == 0 or value == 1) then
          value = value == 1
        end
        local failure = validate(key, value)
        if failure == nil then
          if key.inverted then
            value = not value
          end
          if source ~= key.vim_name and source ~= "setup:" .. key.name then
            report(
              deps,
              "alias:" .. source,
              string.format(
                "Markdown Viewer: %s is deprecated; use %s.",
                source,
                key.vim_name
              )
            )
          end
        else
          report(
            deps,
            "invalid:" .. key.name .. ":" .. source .. ":" .. failure.received,
            string.format(
              declared.error_format,
              key.name,
              failure.expected,
              failure.received,
              source
            )
          )
          value, source = nil, nil
        end
      end

      if value == nil then
        value, source = key.default, "default"
      end
      values[key.name] = value
      sources[key.name] = source
    end
  end

  local nested = deps.g("mkdp_preview_options")
  if type(nested) == "table" then
    local known = {}
    for _, key in ipairs(declared.keys) do
      if key.alias ~= nil and key.alias_scope == "preview_options" then
        known[key.alias] = true
      end
    end
    for name in pairs(nested) do
      if not known[name] then
        report(
          deps,
          "unknown:" .. name,
          string.format(
            'Markdown Viewer: unknown g:mkdp_preview_options key "%s"; ignored.',
            name
          )
        )
      end
    end
  end

  return { values = values, sources = sources }
end

--- @param settings table|nil the nested `setup{}` table
--- @param deps { notify: fun(text:string), warned: table, g: fun(name:string):any }|nil
function M.normalize(settings, deps)
  local effective = deps
    or {
      notify = function() end,
      warned = {},
      g = function() end,
    }
  return normalizer(settings or {}, effective)
end

--- The five groups and the configuration frame entries in declaration order.
function M.split(normalized)
  local groups = {
    editor = {},
    endpoint = {},
    render = {},
    display = {},
    process = {},
    frame = {},
  }

  for _, key in ipairs(declared.keys) do
    if not key.container then
      local value = normalized.values[key.name]
      local source = normalized.sources[key.name]
      local name = key.class == "page-display" and "display" or key.class
      groups[name][key.name] = value
      if
        (key.class == "render" or key.class == "page-display")
        and source ~= "default"
        and value ~= nil
      then
        table.insert(groups.frame, { key = key.name, value = value, source = source })
      end
    end
  end

  return groups
end

--- A stable hash of the values the page is sent, for the live-change trigger.
function M.hash(normalized)
  local parts = {}
  for _, entry in ipairs(M.split(normalized).frame) do
    table.insert(
      parts,
      entry.key .. "=" .. serialize(entry.value) .. "|" .. entry.source
    )
  end
  return vim.fn.sha256(table.concat(parts, "\n"))
end

return M

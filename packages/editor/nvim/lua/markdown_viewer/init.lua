-- The Neovim entry point: `require("markdown_viewer").setup{ ... }`.
--
-- The setup table is nested and the setup path is exactly the dotted key, so
-- `setup{ preview = { width = "900px" } }` names `preview.width`. The container
-- row `preview.options` has no setup path; its children are read at their own
-- dotted paths (G-44).
local config = require("markdown_viewer.config")

local M = {}

local state = {
  settings = {},
  deps = nil,
  normalized = nil,
}

local function default_deps()
  return {
    notify = function(text)
      vim.notify(text, vim.log.levels.WARN)
    end,
    warned = {},
    g = function(name)
      return vim.g[name]
    end,
  }
end

--- Apply one setup table. The warn-once record survives a re-call, so a
--- permanently set baseline spelling warns once per session (Decision L).
function M.setup(settings, deps)
  state.settings = settings or {}
  state.deps = deps or state.deps or default_deps()
  state.normalized = nil
  local session = package.loaded["markdown_viewer.session"]
  if session ~= nil then
    session.config_changed()
  end
end

--- The normalized configuration, cached until the next `setup{}` call.
function M.get()
  if state.normalized == nil then
    state.deps = state.deps or default_deps()
    state.normalized = config.normalize(state.settings, state.deps)
  end
  return state.normalized
end

--- The normalized configuration, re-read from the carriers.
function M.refresh()
  state.deps = state.deps or default_deps()
  state.normalized = config.normalize(state.settings, state.deps)
  return state.normalized
end

function M.hash()
  return config.hash(M.get())
end

return M

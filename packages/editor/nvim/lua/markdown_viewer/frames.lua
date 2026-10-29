local codec = require("markdown_viewer.generated.codec")

local M = {}

--- Neovim's stdout is line-split by default: join the trailing partial line,
--- then hand each complete line to the generated decoder. No raw pipe, no
--- length bookkeeping.
function M.handler(on_message, on_error)
  local partial = ""

  local function read(line)
    if line == "" then
      return
    end
    local message, failure = codec.decode_frame(line)
    if message ~= nil then
      on_message(message)
    else
      on_error(failure)
    end
  end

  return function(_, data)
    for index, value in ipairs(data) do
      if index == 1 then
        partial = partial .. value
      else
        read(partial)
        partial = value
      end
    end
  end
end

function M.send(job, data)
  return vim.fn.chansend(job, data) > 0
end

function M.close_stdin(job)
  pcall(vim.fn.chanclose, job, "stdin")
end

return M

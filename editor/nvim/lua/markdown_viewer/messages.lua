local M = {}

M.unnamed = "Markdown Viewer: write the buffer to a file first, then run :MarkdownPreview."
M.not_running = "Markdown Viewer: no preview is running."

function M.oversize(bytes)
  return string.format(
    "Markdown Viewer: the buffer exceeds the %d-byte frame cap; split the file and retry.",
    bytes
  )
end

function M.start_failed(log)
  return string.format(
    "Markdown Viewer: the server did not start. Log: %s. Run :MarkdownPreview again.",
    log
  )
end

function M.timeout(ms, log)
  return string.format(
    "Markdown Viewer: the server did not answer within %d ms. Log: %s.",
    ms,
    log
  )
end

function M.dead_server(log, code)
  return string.format(
    "Markdown Viewer: the server exited (%s). Log: %s. Run :MarkdownPreview to start it again.",
    tostring(code),
    log
  )
end

return M

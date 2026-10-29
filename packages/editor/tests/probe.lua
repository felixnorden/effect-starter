-- Read the committed golden frames and the 1 MB fixture through the generated
-- Neovim codec. Print one line per fact; exit non-zero on the first mismatch.
-- The runner is `scripts/editor-probe.ts`.
local source = debug.getinfo(1, "S").source:sub(2)
local root = vim.fn.fnamemodify(source, ":p:h:h:h:h")
local frames_dir = root .. "/fixtures/generated/editor-frames"

local function out(line)
  io.stdout:write(line .. "\n")
  io.stdout:flush()
end

local function fail(message)
  out("FAIL nvim " .. message)
  os.exit(1)
end

local function read_file(path)
  local file = io.open(path, "rb")
  if file == nil then
    return nil
  end
  local contents = file:read("*a")
  file:close()
  return contents
end

local function equal(left, right)
  if type(left) ~= type(right) then
    return false
  end
  if type(left) ~= "table" then
    return left == right
  end
  for key, value in pairs(left) do
    if not equal(value, right[key]) then
      return false
    end
  end
  for key in pairs(right) do
    if left[key] == nil then
      return false
    end
  end
  return true
end

local loaded, codec = pcall(require, "markdown_viewer.generated.codec")
if not loaded then
  fail("generated codec does not load: " .. tostring(codec))
end

local version = vim.version()
out(string.format("nvim version: %d.%d.%d", version.major, version.minor, version.patch))

local manifest_text = read_file(frames_dir .. "/cases.json")
if manifest_text == nil then
  fail("no golden manifest at " .. frames_dir .. "; run bun run frames:generate")
end
local manifest = vim.json.decode(manifest_text)

for _, case in ipairs(manifest.cases) do
  local frame = read_file(frames_dir .. "/" .. case.file)
  if frame == nil then
    fail("missing golden frame " .. case.file)
  end
  local message, failure = codec.decode_frame(frame)
  if message == nil then
    fail("golden " .. case.name .. ": " .. tostring(failure and failure.detail))
  end
  if not equal(message, case.message) then
    fail("golden " .. case.name .. ": decoded value differs")
  end
  local again, second = codec.decode_frame(codec.encode_frame(message))
  if again == nil or not equal(again, case.message) then
    fail("golden " .. case.name .. ": re-encode differs: " .. tostring(second and second.detail))
  end
end
out("nvim golden: OK (" .. #manifest.cases .. " frames)")

local mismatch_frame = read_file(frames_dir .. "/version-mismatch.frame")
local message, failure = codec.decode_frame(mismatch_frame)
if message ~= nil or failure == nil or failure._tag ~= "mismatch" then
  fail("version mismatch: expected a mismatch read")
end
if failure.clientVersion ~= manifest.versionMismatch.clientVersion then
  fail("version mismatch: client version differs")
end
if failure.serverVersion ~= manifest.versionMismatch.serverVersion then
  fail("version mismatch: server version differs")
end
out("nvim version mismatch: OK")

local text = read_file(root .. "/fixtures/generated/1mb.md")
if text == nil then
  out("SKIP nvim 1mb: fixtures/generated/1mb.md is missing")
else
  local started = vim.uv.hrtime()
  local document = {
    _tag = "document",
    editorProtocolVersion = codec.editor_protocol_version,
    path = "fixtures/generated/1mb.md",
    text = text,
  }
  local frame = codec.encode_frame(document)
  if #frame > codec.max_frame_bytes then
    fail("1mb: frame exceeds the cap")
  end
  local decoded, second = codec.decode_frame(frame)
  if decoded == nil then
    fail("1mb: " .. tostring(second and second.detail))
  end
  if decoded.text ~= text then
    fail("1mb: text differs after the round-trip")
  end
  local elapsed = (vim.uv.hrtime() - started) / 1e6
  out(string.format("nvim 1mb: OK (%d bytes, %.2f ms)", #frame, elapsed))
end

local cat = vim.fn.exepath("cat")
local line_file = os.getenv("MDV_PROBE_LINE_FILE")
if cat == "" then
  out("SKIP nvim line channel: no cat binary")
elseif line_file == nil or line_file == "" or vim.fn.filereadable(line_file) == 0 then
  out("SKIP nvim line channel: no one-megabyte line file")
else
  local lines = {}
  local partial = ""
  local finished = false
  local function append(data)
    for index, value in ipairs(data) do
      if index == 1 then
        partial = partial .. value
      else
        lines[#lines + 1] = partial
        partial = value
      end
    end
  end

  local job = vim.fn.jobstart({ cat, line_file }, {
    stdout_buffered = false,
    on_stdout = function(_, data)
      append(data)
    end,
    on_exit = function()
      finished = true
    end,
  })
  if job <= 0 then
    fail("line channel: jobstart failed")
  end
  local waited = vim.wait(15000, function()
    return finished
  end, 10)
  if not waited then
    fail("line channel: the 1 MB line did not arrive")
  end
  if partial ~= "" then
    lines[#lines + 1] = partial
    partial = ""
  end
  if #lines ~= 1 then
    fail(string.format("line channel: expected one line, got %d", #lines))
  end
  if #lines[1] ~= 1048576 then
    fail(string.format("line channel: expected 1048576 bytes, got %d", #lines[1]))
  end
  out(string.format("nvim line channel: OK (%d bytes)", #lines[1]))
end

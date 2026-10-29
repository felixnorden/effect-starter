" Read the committed golden frames and the 1 MB fixture through the generated
" Vim codec. Print one line per fact; exit non-zero on the first mismatch.
" The runner is `scripts/editor-probe.ts`.
let s:root = expand('<sfile>:p:h:h:h:h')
let s:frames = s:root . '/fixtures/generated/editor-frames'
let &runtimepath = s:root . '/packages/editor/vim,' . &runtimepath

function! s:Out(line) abort
  " Ex mode has no stdout echo; /dev/stdout is the portable Unix answer. The
  " Windows line stays unverified and is recorded as such.
  call writefile([a:line], '/dev/stdout', 'a')
endfunction

function! s:Fail(message) abort
  call s:Out('FAIL vim ' . a:message)
  cquit
endfunction

function! s:ReadFile(path) abort
  if !filereadable(a:path)
    return v:null
  endif
  " readfile() strips the newline even in binary mode; a Blob keeps every byte.
  return list2str(blob2list(readblob(a:path)))
endfunction

function! s:Equal(left, right) abort
  if type(a:left) != type(a:right)
    return 0
  endif
  if type(a:left) == v:t_dict
    if len(a:left) != len(a:right)
      return 0
    endif
    for l:key in keys(a:left)
      if !has_key(a:right, l:key) || !s:Equal(a:left[l:key], a:right[l:key])
        return 0
      endif
    endfor
    return 1
  elseif type(a:left) == v:t_list
    if len(a:left) != len(a:right)
      return 0
    endif
    let l:index = 0
    while l:index < len(a:left)
      if !s:Equal(a:left[l:index], a:right[l:index])
        return 0
      endif
      let l:index += 1
    endwhile
    return 1
  endif
  return a:left ==# a:right
endfunction

let s:lines = []

function! s:OnOut(channel, message) abort
  call add(s:lines, a:message)
endfunction

call s:Out('vim version: ' . v:version)
call s:Out('vim patch-8.2.1978: ' . (has('patch-8.2.1978') ? 1 : 0))

let s:manifest_text = s:ReadFile(s:frames . '/cases.json')
if s:manifest_text is v:null
  call s:Fail('no golden manifest at ' . s:frames . '; run bun run frames:generate')
endif
let s:manifest = json_decode(s:manifest_text)

for s:case in s:manifest.cases
  let s:frame = s:ReadFile(s:frames . '/' . s:case.file)
  if s:frame is v:null
    call s:Fail('missing golden frame ' . s:case.file)
  endif
  let [s:ok, s:message] = markdown_viewer#generated#codec#decode_frame(s:frame)
  if !s:ok
    call s:Fail('golden ' . s:case.name . ': ' . string(get(s:message, 'detail', 'decode failed')))
  endif
  if !s:Equal(s:message, s:case.message)
    call s:Fail('golden ' . s:case.name . ': decoded value differs')
  endif
  let [s:ok2, s:again] = markdown_viewer#generated#codec#decode_frame(markdown_viewer#generated#codec#encode_frame(s:message))
  if !s:ok2 || !s:Equal(s:again, s:case.message)
    call s:Fail('golden ' . s:case.name . ': re-encode differs')
  endif
endfor
call s:Out('vim golden: OK (' . len(s:manifest.cases) . ' frames)')

let s:mismatch_frame = s:ReadFile(s:frames . '/version-mismatch.frame')
let [s:ok, s:failure] = markdown_viewer#generated#codec#decode_frame(s:mismatch_frame)
if s:ok || get(s:failure, '_tag', '') !=# 'mismatch'
  call s:Fail('version mismatch: expected a mismatch read')
endif
if get(s:failure, 'clientVersion', -1) != s:manifest.versionMismatch.clientVersion
  call s:Fail('version mismatch: client version differs')
endif
if get(s:failure, 'serverVersion', -1) != s:manifest.versionMismatch.serverVersion
  call s:Fail('version mismatch: server version differs')
endif
call s:Out('vim version mismatch: OK')

let s:text = s:ReadFile(s:root . '/fixtures/generated/1mb.md')
if s:text is v:null
  call s:Out('SKIP vim 1mb: fixtures/generated/1mb.md is missing')
else
  let s:started = reltime()
  let s:document = {
        \ '_tag': 'document',
        \ 'editorProtocolVersion': markdown_viewer#generated#codec#version(),
        \ 'path': 'fixtures/generated/1mb.md',
        \ 'text': s:text,
        \ }
  let s:frame = markdown_viewer#generated#codec#encode_frame(s:document)
  if strlen(s:frame) > markdown_viewer#generated#wire#get().max_frame_bytes
    call s:Fail('1mb: frame exceeds the cap')
  endif
  let [s:ok, s:decoded] = markdown_viewer#generated#codec#decode_frame(s:frame)
  if !s:ok
    call s:Fail('1mb: ' . string(get(s:decoded, 'detail', 'decode failed')))
  endif
  if !s:Equal(s:decoded.text, s:text)
    call s:Fail('1mb: text differs after the round-trip')
  endif
  call s:Out(printf('vim 1mb: OK (%d bytes, %.2f ms)', strlen(s:frame), reltimefloat(reltime(s:started)) * 1000.0))
endif

if !has('job') || !has('channel') || !exists('*job_start')
  call s:Out('SKIP vim line channel: +job or +channel is missing')
elseif executable('cat') == 0
  call s:Out('SKIP vim line channel: no cat binary')
elseif empty($MDV_PROBE_LINE_FILE) || !filereadable($MDV_PROBE_LINE_FILE)
  call s:Out('SKIP vim line channel: no one-megabyte line file')
else
  let s:lines = []
  let s:job = job_start(['cat', $MDV_PROBE_LINE_FILE], {'out_mode': 'nl', 'out_cb': function('s:OnOut')})
  if type(s:job) == v:t_string
    call s:Fail('line channel: job_start failed: ' . s:job)
  endif
  let s:started = reltime()
  while job_status(s:job) ==# 'run' && reltimefloat(reltime(s:started)) < 15.0
    sleep 10m
  endwhile
  " Channel callbacks run while Vim waits; give the last message one window.
  sleep 50m
  if len(s:lines) != 1
    call s:Fail(printf('line channel: expected one line, got %d', len(s:lines)))
  endif
  if strlen(s:lines[0]) != 1048576
    call s:Fail(printf('line channel: expected 1048576 bytes, got %d', strlen(s:lines[0])))
  endif
  call s:Out(printf('vim line channel: OK (%d bytes)', strlen(s:lines[0])))
endif

qall!

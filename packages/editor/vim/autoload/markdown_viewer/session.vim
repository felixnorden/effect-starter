" The same row, teardown, timeout, and messages as the Neovim adapter.

let s:START_TIMEOUT_MS = 5000
let s:EXIT_GRACE_MS = 500

let s:row = v:null
let s:expected_exit = {}
let s:log_counter = 0

function! markdown_viewer#session#log_directory() abort
  if has('win32') || has('win64')
    if type($LOCALAPPDATA) == v:t_string && $LOCALAPPDATA !=# ''
      return $LOCALAPPDATA . '/markdown-viewer'
    endif
  elseif has('macunix')
    if $HOME !=# ''
      return $HOME . '/Library/Caches/markdown-viewer'
    endif
  else
    if $XDG_CACHE_HOME !=# '' && $XDG_CACHE_HOME[0] ==# '/'
      return $XDG_CACHE_HOME . '/markdown-viewer'
    endif
    if $HOME !=# ''
      return $HOME . '/.cache/markdown-viewer'
    endif
  endif
  if $TMPDIR !=# ''
    return $TMPDIR . '/markdown-viewer'
  endif
  return tempname() . '/markdown-viewer'
endfunction

function! s:LogPath() abort
  let l:dir = markdown_viewer#session#log_directory()
  call mkdir(l:dir, 'p')
  let s:log_counter += 1
  return printf('%s/%d-%d-%d.log', l:dir, getpid(), localtime(), s:log_counter)
endfunction

function! s:Notify(text) abort
  echohl ErrorMsg
  echomsg a:text
  echohl None
endfunction

function! s:ClearTimer(current) abort
  if a:current.timer >= 0
    call timer_stop(a:current.timer)
    let a:current.timer = -1
  endif
endfunction

function! s:Kill(job, timer) abort
  try
    call job_stop(a:job)
  catch
  endtry
endfunction

function! s:Report(current, text) abort
  if a:current.last_reported isnot v:null && a:current.last_reported ==# a:text
    return
  endif
  let a:current.last_reported = a:text
  call s:Notify(a:text)
endfunction

function! s:Teardown(current, reason) abort
  if a:current isnot s:row
    return
  endif

  let s:row = v:null
  call s:ClearTimer(a:current)

  if a:current.job isnot v:null && !a:current.exited
    let s:expected_exit[string(a:current.job)] = 1
    call markdown_viewer#frames#close_stdin(a:current.job)
    if exists('*timer_start')
      call timer_start(s:EXIT_GRACE_MS, function('s:Kill', [a:current.job]))
    endif
  endif

  if a:reason isnot v:null
        \ && (a:current.last_reported is v:null || a:reason !=# a:current.last_reported)
    let a:current.last_reported = a:reason
    call s:Notify(a:reason)
  endif
endfunction

function! s:OnError(current, detail, fatal) abort
  if a:current isnot s:row
    return
  endif
  if a:current.last_reported isnot v:null && a:current.last_reported ==# a:detail
    return
  endif
  let a:current.last_reported = a:detail
  let a:current.fatal = a:fatal
  call s:Notify(a:detail)
  " An error while starting is terminal; one while open keeps the row.
  if a:current.state ==# 'starting'
    call s:Teardown(a:current, v:null)
  endif
endfunction

function! s:OnFrameError(current, failure) abort
  let l:detail = type(a:failure) == v:t_dict
        \ ? get(a:failure, 'detail', 'Markdown Viewer: unreadable frame.')
        \ : 'Markdown Viewer: unreadable frame.'
  call s:OnError(a:current, l:detail, 0)
endfunction

function! s:Open(url) abort
  if has('win32') || has('win64')
    let l:cmd = ['cmd', '/c', 'start', '', a:url]
  elseif has('macunix')
    let l:cmd = ['open', a:url]
  else
    let l:cmd = ['xdg-open', a:url]
  endif
  call job_start(l:cmd)
endfunction

function! s:OnMessage(current, message) abort
  if a:current isnot s:row
    return
  endif

  if a:message._tag ==# 'ready'
    if a:current.state !=# 'starting'
      return
    endif
    call s:ClearTimer(a:current)
    let a:current.state = 'open'
    let a:current.url = a:message.url
    call s:Open(a:message.url)
    return
  endif

  if a:message._tag ==# 'error'
    call s:OnError(a:current, a:message.message, has_key(a:message, 'clientVersion') || has_key(a:message, 'serverVersion'))
  endif
endfunction

function! s:OnExit(current, job, code) abort
  let a:current.exited = 1
  let l:key = string(a:job)
  if has_key(s:expected_exit, l:key)
    call remove(s:expected_exit, l:key)
    return
  endif
  if a:current isnot s:row
    return
  endif
  if a:current.fatal
    call s:Teardown(a:current, v:null)
    return
  endif
  let l:message = markdown_viewer#messages#dead_server(a:current.log, a:code)
  if a:current.last_reported is v:null || a:current.last_reported !=# l:message
    let a:current.last_reported = l:message
    call s:Notify(l:message)
  endif
  call s:Teardown(a:current, v:null)
endfunction

function! s:OnTimeout(current, timer) abort
  if a:current is s:row && a:current.state ==# 'starting'
    call s:Teardown(a:current, markdown_viewer#messages#timeout(s:START_TIMEOUT_MS, a:current.log))
  endif
endfunction

" The one document builder: unnamed refused, cap refused, otherwise a frame.
function! s:DocumentFrame(current) abort
  let l:name = bufname('%')
  if l:name ==# ''
    call s:Report(a:current, markdown_viewer#messages#unnamed())
    return v:null
  endif

  let l:path = fnamemodify(l:name, ':p')
  let l:text = join(getline(1, '$'), "\n") . "\n"
  let l:message = {
        \ '_tag': 'document',
        \ 'editorProtocolVersion': markdown_viewer#generated#codec#version(),
        \ 'path': l:path,
        \ 'text': l:text,
        \ }
  let l:frame = markdown_viewer#generated#codec#encode_frame(l:message)
  if strlen(l:frame) > markdown_viewer#generated#wire#get().max_frame_bytes
    call s:Report(
          \ a:current,
          \ markdown_viewer#messages#oversize(markdown_viewer#generated#wire#get().max_frame_bytes))
    return v:null
  endif
  return l:frame
endfunction

function! s:Start() abort
  if !has('patch-8.2.1978')
    call s:Notify(markdown_viewer#messages#floor())
    return
  endif

  let l:current = {
        \ 'state': 'starting',
        \ 'job': v:null,
        \ 'url': v:null,
        \ 'log': v:null,
        \ 'last_reported': v:null,
        \ 'timer': -1,
        \ 'exited': 0,
        \ 'fatal': 0,
        \ }
  let l:frame = s:DocumentFrame(l:current)
  if l:frame is v:null
    return
  endif

  let l:found = markdown_viewer#discovery#find({})
  if !l:found.ok
    call s:Notify(l:found.message)
    return
  endif

  let l:current.log = s:LogPath()
  let l:cmd = [l:found.command] + l:found.args + ['editor', '--log-file', l:current.log]
  let s:row = l:current

  try
    let l:job = job_start(l:cmd, {
          \ 'in_io': 'pipe',
          \ 'out_io': 'pipe',
          \ 'out_mode': 'nl',
          \ 'out_cb': markdown_viewer#frames#handler(
          \   function('s:OnMessage', [l:current]),
          \   function('s:OnFrameError', [l:current])),
          \ 'exit_cb': function('s:OnExit', [l:current]),
          \ })
  catch
    let s:row = v:null
    call s:Notify(markdown_viewer#messages#start_failed(l:current.log))
    return
  endtry

  if type(l:job) != v:t_job || job_status(l:job) ==# 'fail'
    let s:row = v:null
    call s:Notify(markdown_viewer#messages#start_failed(l:current.log))
    return
  endif

  let l:current.job = l:job
  if !markdown_viewer#frames#send(l:job, l:frame)
    call s:Teardown(l:current, markdown_viewer#messages#start_failed(l:current.log))
    return
  endif

  if exists('*timer_start')
    let l:current.timer = timer_start(
          \ s:START_TIMEOUT_MS,
          \ function('s:OnTimeout', [l:current]))
  endif
endfunction

function! s:Refresh(current) abort
  let l:frame = s:DocumentFrame(a:current)
  if l:frame is v:null
    return
  endif
  if !markdown_viewer#frames#send(a:current.job, l:frame)
    call s:Report(a:current, markdown_viewer#messages#dead_server(a:current.log, 'closed'))
    call s:Teardown(a:current, v:null)
  endif
endfunction

function! markdown_viewer#session#preview() abort
  if s:row is v:null
    call s:Start()
    return
  endif
  if s:row.state ==# 'starting'
    return
  endif
  call s:Refresh(s:row)
endfunction

function! markdown_viewer#session#stop() abort
  if s:row isnot v:null
    call s:Teardown(s:row, v:null)
  endif
endfunction

function! markdown_viewer#session#toggle() abort
  if s:row is v:null
    call markdown_viewer#session#preview()
    return
  endif
  call s:Teardown(s:row, v:null)
endfunction

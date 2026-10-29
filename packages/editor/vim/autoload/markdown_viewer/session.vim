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
  if a:current.refresh isnot v:null
    call call(a:current.refresh.stop, [])
  endif
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

function! s:OnBufferGone(bufnr) abort
  if s:row is v:null || s:row.refresh is v:null
    return
  endif
  let l:bound = call(s:row.refresh.bound, [])
  if l:bound is v:null || a:bufnr != l:bound
    return
  endif
  call markdown_viewer#session#stop()
endfunction

" The one builder: the text-length lower bound first, then unnamed and cap.
function! s:EncodeDocument(current, path, text) abort
  if a:path ==# ''
    call s:Report(a:current, markdown_viewer#messages#unnamed())
    return v:null
  endif
  " The encoded frame contains the text escaped and never shortened.
  let l:max = markdown_viewer#generated#wire#get().max_frame_bytes
  if strlen(a:text) >= l:max
    call s:Report(a:current, markdown_viewer#messages#oversize(l:max))
    return v:null
  endif
  let l:message = {
        \ '_tag': 'document',
        \ 'editorProtocolVersion': markdown_viewer#generated#codec#version(),
        \ 'path': a:path,
        \ 'text': a:text,
        \ }
  let l:frame = markdown_viewer#generated#codec#encode_frame(l:message)
  if strlen(l:frame) > l:max
    call s:Report(a:current, markdown_viewer#messages#oversize(l:max))
    return v:null
  endif
  return l:frame
endfunction

" The one wire path for a later frame: the manual command and the refresh
" module both reach it. Returns whether the frame left.
function! s:Transmit(current, path, text) abort
  let l:frame = s:EncodeDocument(a:current, a:path, a:text)
  if l:frame is v:null
    return 0
  endif
  if !markdown_viewer#frames#send(a:current.job, l:frame)
    call s:Report(a:current, markdown_viewer#messages#dead_server(a:current.log, 'closed'))
    call s:Teardown(a:current, v:null)
    return 0
  endif
  return 1
endfunction

" The refresh module's send: the row must be open (M-5).
function! s:SendDocument(current, path, text) abort
  if a:current isnot s:row || a:current.state !=# 'open'
    return 0
  endif
  return s:Transmit(a:current, a:path, a:text)
endfunction

function! s:ReadBuffer(bufnr) abort
  let l:bufnr = a:bufnr is v:null ? bufnr('%') : a:bufnr
  if !bufexists(l:bufnr) || !bufloaded(l:bufnr)
    return v:null
  endif
  let l:name = bufname(l:bufnr)
  if l:name ==# ''
    return v:null
  endif
  return {
        \ 'bufnr': l:bufnr,
        \ 'path': fnamemodify(l:name, ':p'),
        \ 'text': join(getbufline(l:bufnr, 1, '$'), "\n") . "\n",
        \ }
endfunction

function! s:Now() abort
  return float2nr(reltimefloat(reltime()) * 1000.0)
endfunction

function! s:Schedule(ms, fn) abort
  if !exists('*timer_start')
    return -1
  endif
  return timer_start(a:ms, a:fn)
endfunction

function! s:CancelTimer(handle) abort
  if exists('*timer_stop') && type(a:handle) == v:t_number && a:handle > 0
    call timer_stop(a:handle)
  endif
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
        \ 'refresh': v:null,
        \ }
  let l:name = bufname('%')
  let l:path = l:name ==# '' ? '' : fnamemodify(l:name, ':p')
  let l:text = join(getline(1, '$'), "\n") . "\n"
  let l:frame = s:EncodeDocument(l:current, l:path, l:text)
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

  let l:current.refresh = markdown_viewer#refresh#new({
        \ 'read': function('s:ReadBuffer'),
        \ 'send': function('s:SendDocument', [l:current]),
        \ 'now': function('s:Now'),
        \ 'timer': {
        \   'schedule': function('s:Schedule'),
        \   'cancel': function('s:CancelTimer'),
        \ },
        \ })

  augroup markdown_viewer_refresh
    autocmd BufDelete,BufWipeout * call s:OnBufferGone(str2nr(expand('<abuf>')))
    autocmd VimLeavePre * call markdown_viewer#session#stop()
  augroup END

  if exists('*timer_start')
    let l:current.timer = timer_start(
          \ s:START_TIMEOUT_MS,
          \ function('s:OnTimeout', [l:current]))
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
  call call(s:row.refresh.manual, [])
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

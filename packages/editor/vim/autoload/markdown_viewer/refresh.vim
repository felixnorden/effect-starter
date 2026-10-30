" The same window arithmetic, gate order, and teardown as the Neovim module.
" Each row owns one group; no module-level current session.

let s:WINDOW_MS = 33
let s:handles = {}
let s:COALESCED = {
      \ 'CursorHold': 1,
      \ 'CursorHoldI': 1,
      \ 'CursorMoved': 1,
      \ 'CursorMovedI': 1,
      \ }

function! s:Attempt(state, subject, skip_compare, want_cursor) abort
  let l:read = call(a:state.deps.read, [a:subject])
  if l:read is v:null
    return 0
  endif
  if a:state.bound is v:null
    let a:state.bound = l:read.bufnr
  endif
  if l:read.bufnr != a:state.bound
    return 0
  endif
  if !a:skip_compare && l:read.text ==# a:state.sent
    if a:want_cursor && has_key(a:state.deps, 'send_cursor')
      call call(a:state.deps.send_cursor, [])
    endif
    return 0
  endif
  if call(a:state.deps.send, [l:read.path, l:read.text])
    let a:state.sent = l:read.text
    if a:want_cursor && has_key(a:state.deps, 'send_cursor')
      call call(a:state.deps.send_cursor, [])
    endif
    return 1
  endif
  return 0
endfunction

function! s:Flush(state) abort
  let l:window = a:state.pending
  let a:state.pending = v:null
  if a:state.stopped || l:window is v:null
    return
  endif
  if l:window.wake
    call s:Attempt(a:state, a:state.bound, 0, l:window.cursor)
  endif
endfunction

function! s:OpenWindow(state) abort
  let l:due = call(a:state.deps.now, []) + s:WINDOW_MS
  let l:handle = call(a:state.deps.timer.schedule, [
        \ l:due - call(a:state.deps.now, []),
        \ {-> s:Flush(a:state)},
        \ ])
  " A nil or non-positive handle means the window cannot open (M-11).
  if type(l:handle) == v:t_number && l:handle <= 0
    return
  endif
  if l:handle is v:null
    return
  endif
  let a:state.pending = {'handle': l:handle, 'wake': 0, 'cursor': 0}
endfunction

function! s:Coalesce(state, subject, want_cursor) abort
  if a:state.pending isnot v:null
    let a:state.pending.wake = 1
    let a:state.pending.cursor = a:state.pending.cursor || a:want_cursor
    return
  endif
  if s:Attempt(a:state, a:subject, 0, a:want_cursor)
    call s:OpenWindow(a:state)
  endif
endfunction

function! s:On(state, kind, subject) abort
  if a:state.stopped
    return
  endif
  if has_key(a:state.deps, 'before_send')
    call call(a:state.deps.before_send, [])
  endif
  if has_key(s:COALESCED, a:kind)
    call s:Coalesce(a:state, a:subject, 1)
    return
  endif
  if a:kind ==# 'BufWritePost' || a:kind ==# 'InsertLeave'
    call s:Attempt(a:state, a:subject, 0, 0)
  endif
endfunction

function! s:Manual(state) abort
  if a:state.stopped
    return
  endif
  if has_key(a:state.deps, 'before_send')
    call call(a:state.deps.before_send, [])
  endif
  if a:state.pending isnot v:null
    call call(a:state.deps.timer.cancel, [a:state.pending.handle])
    let a:state.pending = v:null
  endif
  if a:state.bound isnot v:null
    call s:Attempt(a:state, a:state.bound, 1, 0)
  endif
endfunction

function! s:Rebind(state) abort
  if a:state.stopped
    return
  endif
  if has_key(a:state.deps, 'send_cursor')
    call call(a:state.deps.send_cursor, [])
  endif
endfunction

function! s:Stop(state) abort
  let a:state.stopped = 1
  if a:state.pending isnot v:null
    call call(a:state.deps.timer.cancel, [a:state.pending.handle])
    let a:state.pending = v:null
  endif
  let a:state.bound = v:null
  let a:state.sent = v:null
  if has_key(s:handles, a:state.group)
    call remove(s:handles, a:state.group)
  endif
  execute 'augroup ' . a:state.group
  autocmd!
  augroup END
endfunction

function! s:Bound(state) abort
  return a:state.bound
endfunction

function! markdown_viewer#refresh#dispatch(group, kind, subject) abort
  if has_key(s:handles, a:group)
    call call(s:handles[a:group].on, [a:kind, a:subject])
  endif
endfunction

function! markdown_viewer#refresh#new(deps) abort
  let l:group = has_key(a:deps, 'group') ? a:deps.group : 'markdown_viewer_refresh'
  let l:state = {
        \ 'deps': a:deps,
        \ 'group': l:group,
        \ 'bound': v:null,
        \ 'sent': v:null,
        \ 'pending': v:null,
        \ 'stopped': 0,
        \ }

  let l:handle = {
        \ 'on': {kind, subject -> s:On(l:state, kind, subject)},
        \ 'manual': {-> s:Manual(l:state)},
        \ 'rebind': {-> s:Rebind(l:state)},
        \ 'stop': {-> s:Stop(l:state)},
        \ 'bound': {-> s:Bound(l:state)},
        \ }

  " The first frame already left before this module was built.
  let l:initial = call(a:deps.read, [v:null])
  if l:initial isnot v:null
    let l:state.bound = l:initial.bufnr
    let l:state.sent = l:initial.text
  endif

  let s:handles[l:group] = l:handle
  execute 'augroup ' . l:group
  autocmd!
  autocmd CursorHold * call markdown_viewer#refresh#dispatch(l:group, 'CursorHold', bufnr('%'))
  autocmd CursorHoldI * call markdown_viewer#refresh#dispatch(l:group, 'CursorHoldI', bufnr('%'))
  autocmd CursorMoved * call markdown_viewer#refresh#dispatch(l:group, 'CursorMoved', bufnr('%'))
  autocmd CursorMovedI * call markdown_viewer#refresh#dispatch(l:group, 'CursorMovedI', bufnr('%'))
  autocmd BufWritePost * call markdown_viewer#refresh#dispatch(l:group, 'BufWritePost', str2nr(expand('<abuf>')))
  autocmd InsertLeave * call markdown_viewer#refresh#dispatch(l:group, 'InsertLeave', bufnr('%'))
  augroup END

  return l:handle
endfunction

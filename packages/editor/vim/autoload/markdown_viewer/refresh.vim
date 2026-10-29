" The same window arithmetic, gate order, and teardown as the Neovim module.

let s:WINDOW_MS = 33
let s:COALESCED = {
      \ 'CursorHold': 1,
      \ 'CursorHoldI': 1,
      \ 'CursorMoved': 1,
      \ 'CursorMovedI': 1,
      \ }

let s:current = v:null

function! s:Attempt(state, subject, skip_compare) abort
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
    return 0
  endif
  if call(a:state.deps.send, [l:read.path, l:read.text])
    let a:state.sent = l:read.text
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
    call s:Attempt(a:state, a:state.bound, 0)
  endif
endfunction

function! s:OpenWindow(state) abort
  let l:due = call(a:state.deps.now, []) + s:WINDOW_MS
  let l:handle = call(a:state.deps.timer.schedule, [
        \ l:due - call(a:state.deps.now, []),
        \ function('s:Flush', [a:state]),
        \ ])
  " A nil or non-positive handle means the window cannot open (M-11).
  if type(l:handle) == v:t_number && l:handle <= 0
    return
  endif
  if l:handle is v:null
    return
  endif
  let a:state.pending = {'handle': l:handle, 'wake': 0}
endfunction

function! s:Coalesce(state, subject) abort
  if a:state.pending isnot v:null
    let a:state.pending.wake = 1
    return
  endif
  if s:Attempt(a:state, a:subject, 0)
    call s:OpenWindow(a:state)
  endif
endfunction

function! s:On(state, kind, subject) abort
  if a:state.stopped
    return
  endif
  if has_key(s:COALESCED, a:kind)
    call s:Coalesce(a:state, a:subject)
    return
  endif
  if a:kind ==# 'BufWritePost' || a:kind ==# 'InsertLeave'
    call s:Attempt(a:state, a:subject, 0)
  endif
endfunction

function! s:Dispatch(kind) abort
  if s:current is v:null
    return
  endif
  call s:On(s:current, a:kind, bufnr('%'))
endfunction

function! s:DispatchBuf(kind, bufnr) abort
  if s:current is v:null
    return
  endif
  call s:On(s:current, a:kind, a:bufnr)
endfunction

function! s:Manual(state) abort
  if a:state.stopped
    return
  endif
  if a:state.pending isnot v:null
    call call(a:state.deps.timer.cancel, [a:state.pending.handle])
    let a:state.pending = v:null
  endif
  if a:state.bound isnot v:null
    call s:Attempt(a:state, a:state.bound, 1)
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
  if s:current is a:state
    let s:current = v:null
  endif
  augroup markdown_viewer_refresh
    autocmd!
  augroup END
endfunction

function! s:Bound(state) abort
  return a:state.bound
endfunction

function! markdown_viewer#refresh#new(deps) abort
  let l:state = {
        \ 'deps': a:deps,
        \ 'bound': v:null,
        \ 'sent': v:null,
        \ 'pending': v:null,
        \ 'stopped': 0,
        \ }

  let l:handle = {
        \ 'on': function('s:On', [l:state]),
        \ 'manual': function('s:Manual', [l:state]),
        \ 'stop': function('s:Stop', [l:state]),
        \ 'bound': function('s:Bound', [l:state]),
        \ }

  " The first frame already left before this module was built.
  let l:initial = call(a:deps.read, [v:null])
  if l:initial isnot v:null
    let l:state.bound = l:initial.bufnr
    let l:state.sent = l:initial.text
  endif

  let s:current = l:state
  augroup markdown_viewer_refresh
    autocmd!
    autocmd CursorHold * call s:Dispatch('CursorHold')
    autocmd CursorHoldI * call s:Dispatch('CursorHoldI')
    autocmd CursorMoved * call s:Dispatch('CursorMoved')
    autocmd CursorMovedI * call s:Dispatch('CursorMovedI')
    autocmd BufWritePost * call s:DispatchBuf('BufWritePost', str2nr(expand('<abuf>')))
    autocmd InsertLeave * call s:Dispatch('InsertLeave')
  augroup END

  return l:handle
endfunction

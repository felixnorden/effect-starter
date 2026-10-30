" The real two-buffer session evidence in Vim: real jobs, one server per row.
" Prints REAL when the callbacks arrive; when `vim -es` cannot deliver job
" callbacks it prints FALLBACK and names the reason (G-27), because a green run
" must not claim evidence it did not get.
" Run with: vim -u NONE -N -es -S packages/editor/tests/sessions-driver.vim

let s:root = expand('<sfile>:p:h:h:h:h')
let &runtimepath = s:root . '/packages/editor/vim,' . &runtimepath

function! s:Out(line) abort
  call writefile([a:line], '/dev/stdout', 'a')
endfunction

function! s:Fail(message) abort
  call s:Out('FAIL editor:sessions: ' . a:message)
  cquit
endfunction

function! s:RowCount(handle) abort
  return len(call(a:handle.rows, []))
endfunction

function! s:WaitOpen(handle, expected) abort
  let l:start = reltime()
  while reltimefloat(reltime(l:start)) < 15.0
    let l:open = 0
    for l:row in values(call(a:handle.rows, []))
      if l:row.state ==# 'open'
        let l:open += 1
      endif
    endfor
    if l:open == a:expected
      return 1
    endif
    sleep 50m
  endwhile
  return 0
endfunction

function! s:WaitRows(handle, expected) abort
  let l:start = reltime()
  while reltimefloat(reltime(l:start)) < 5.0
    if s:RowCount(a:handle) == a:expected
      return 1
    endif
    sleep 50m
  endwhile
  return 0
endfunction

let s:dir = tempname()
call mkdir(s:dir, 'p')
let s:a = s:dir . '/a.md'
let s:b = s:dir . '/b.md'
call writefile(['# A'], s:a)
call writefile(['# B'], s:b)

let g:markdown_viewer_auto_start = v:true
let g:markdown_viewer_auto_close = v:true

let s:opened = []
let s:effects = markdown_viewer#session#default_effects()
let s:effects.open = {url -> add(s:opened, url)}
let s:handle = markdown_viewer#session#new(s:effects)

execute 'edit ' . fnameescape(s:a)
set filetype=markdown
call call(s:handle.auto_start, [bufnr('%')])

execute 'split ' . fnameescape(s:b)
set filetype=markdown
call call(s:handle.auto_start, [bufnr('%')])

if !s:WaitOpen(s:handle, 2)
  call s:Out('FALLBACK vim -es did not deliver job callbacks for two rows')
  qall!
endif
if s:RowCount(s:handle) != 2
  call s:Fail('two buffers did not start two rows')
endif
call s:Out('REAL vim two buffers')

" The health report sees a live session and names its open ports.
let s:ports = v:null
for s:entry in markdown_viewer#health#report({'rows': call(s:handle.rows, [])})
  if s:entry.key ==# 'ports'
    let s:ports = s:entry.value
  endif
endfor
if s:ports is v:null || s:ports ==# 'none'
  call s:Fail('health report named no live session ports')
endif
call s:Out('REAL vim health live ports ' . s:ports)

let s:first = bufnr(s:a)
call call(s:handle.stop, [s:first])
if !s:WaitRows(s:handle, 1)
  call s:Fail('stopping one row left ' . s:RowCount(s:handle) . ' rows')
endif
call s:Out('REAL vim stop one row')

let s:second = bufnr(s:b)
execute 'bdelete ' . s:second
if !s:WaitRows(s:handle, 0)
  call s:Fail('deleting the buffer left ' . s:RowCount(s:handle) . ' rows')
endif
call s:Out('REAL vim auto-close one row')

" A combine switch keeps one row, one address and one page.
let s:c = s:dir . '/c.md'
let s:d = s:dir . '/d.md'
call writefile(['# C'], s:c)
call writefile(['# D'], s:d)
let g:markdown_viewer_combine_preview = v:true
execute 'edit ' . fnameescape(s:c)
set filetype=markdown
call call(s:handle.auto_start, [bufnr('%')])
if !s:WaitOpen(s:handle, 1)
  call s:Fail('combine row did not open')
endif
let s:opened_before = len(s:opened)
let s:url_before = values(call(s:handle.rows, []))[0].url
execute 'edit ' . fnameescape(s:d)
set filetype=markdown
call call(s:handle.enter, [bufnr('%')])
let s:start = reltime()
while reltimefloat(reltime(s:start)) < 5.0
      \ && !has_key(call(s:handle.rows, []), string(bufnr(s:d)))
  sleep 50m
endwhile
let s:combined = get(call(s:handle.rows, []), string(bufnr(s:d)), v:null)
if s:combined is v:null || s:RowCount(s:handle) != 1
  call s:Fail('combine switch did not keep one row: ' . string(call(s:handle.rows, [])))
endif
if len(s:opened) != s:opened_before
  call s:Fail('combine switch opened a second page')
endif
if s:combined.url !=# s:url_before
  call s:Fail('combine switch changed the page address')
endif
call s:Out('REAL vim combine switch')

call call(s:handle.stop, [bufnr('%')])
if !s:WaitRows(s:handle, 0)
  call s:Fail('combine row did not stop')
endif

" The configured port belongs to the earliest live row; a sibling asks for 0.
let s:port = 20000 + (getpid() % 20000)
let g:markdown_viewer_combine_preview = v:false
let g:markdown_viewer_port = s:port
let s:e = s:dir . '/e.md'
let s:f = s:dir . '/f.md'
call writefile(['# E'], s:e)
call writefile(['# F'], s:f)
execute 'edit ' . fnameescape(s:e)
set filetype=markdown
call call(s:handle.auto_start, [bufnr('%')])
execute 'split ' . fnameescape(s:f)
set filetype=markdown
call call(s:handle.auto_start, [bufnr('%')])
if !s:WaitOpen(s:handle, 2)
  call s:Fail('two sibling rows did not open')
endif
let s:urls = []
for s:row in values(call(s:handle.rows, []))
  let s:urls += [s:row.url]
endfor
if len(s:urls) != 2 || s:urls[0] ==# s:urls[1]
  call s:Fail('two sibling rows did not get two addresses')
endif
let s:held = 0
let s:ephemeral = 0
for s:url in s:urls
  if matchstr(s:url, ':\zs\d\+') ==# string(s:port)
    let s:held = 1
  else
    let s:ephemeral = 1
  endif
endfor
if !s:held || !s:ephemeral
  call s:Fail('port rule did not give the configured port to one row and 0 to the other')
endif
call s:Out('REAL vim port rule')

for s:bufnr in keys(call(s:handle.rows, []))
  call call(s:handle.stop, [str2nr(s:bufnr)])
endfor
if !s:WaitRows(s:handle, 0)
  call s:Fail('port rows did not stop')
endif

let s:g = s:dir . '/g.md'
call writefile(['# G'], s:g)
execute 'edit ' . fnameescape(s:g)
set filetype=markdown
call call(s:handle.auto_start, [bufnr('%')])
if !s:WaitOpen(s:handle, 1)
  call s:Fail('port row did not reopen after the siblings ended')
endif
let s:regranted = values(call(s:handle.rows, []))[0].url
if matchstr(s:regranted, ':\zs\d\+') !=# string(s:port)
  call s:Fail('configured port was not free again after every row ended')
endif
call s:Out('REAL vim port free after stop')
call call(s:handle.stop, [bufnr('%')])
if !s:WaitRows(s:handle, 0)
  call s:Fail('last port row did not stop')
endif

if len(s:opened) < 2
  call s:Fail('expected two opened pages, got ' . len(s:opened))
endif
call s:Out('OK editor:sessions (vim, REAL, ' . len(s:opened) . ' pages)')
qall!

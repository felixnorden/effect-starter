" One Vim run of the cursor case file through the session handle.
" Run with: vim -u NONE -N -es -S packages/editor/tests/cursor-driver.vim
let s:root = expand('<sfile>:p:h:h:h:h')
let &runtimepath = s:root . '/packages/editor/vim,' . &runtimepath
execute 'source ' . fnameescape(s:root . '/packages/editor/tests/cursor-replay.vim')

function! s:Out(line) abort
  call writefile([a:line], '/dev/stdout', 'a')
endfunction

function! s:Fail(message) abort
  call s:Out('FAIL editor:cursors: ' . a:message)
  cquit
endfunction

let s:path = s:root . '/packages/editor/tests/cursor-cases.json'
if !filereadable(s:path)
  call s:Fail('no cursor-cases.json')
endif
let s:suite = json_decode(join(readfile(s:path), "\n"))

for s:case in s:suite.cases
  let [s:ok, s:why] = CursorReplayRun(s:case)
  if !s:ok
    call s:Fail(s:case.name . ': ' . s:why)
  endif
  call s:Out('OK cursor ' . s:case.name)
endfor

for s:case in s:suite.fractions
  let s:actual = markdown_viewer#session#cursor_fraction(s:case.winline, s:case.winheight)
  if abs(s:actual - s:case.fraction) > 0.000000001
    call s:Fail('fraction ' . s:case.winline . '/' . s:case.winheight . ' differs')
  endif
endfor
call s:Out('OK editor:cursors (vim, ' . len(s:suite.cases) . ' cases)')
cquit 0

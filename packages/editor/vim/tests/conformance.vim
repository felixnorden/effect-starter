" The recorded Vim conformance run: decode every committed golden frame with
" the real generated codec, then run the shared discovery cases.
" Run with: vim -u NONE -N -es -S packages/editor/vim/tests/conformance.vim < /dev/null
let s:root = expand('<sfile>:p:h:h:h:h:h')
let &runtimepath = s:root . '/packages/editor/vim,' . &runtimepath
let s:frames = s:root . '/fixtures/generated/editor-frames'

function! s:Out(line) abort
  call writefile([a:line], '/dev/stdout', 'a')
endfunction

function! s:Fail(message) abort
  call s:Out('FAIL vim conformance: ' . a:message)
  cquit
endfunction

function! s:ReadFile(path) abort
  if !filereadable(a:path)
    return v:null
  endif
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

let s:manifest_text = s:ReadFile(s:frames . '/cases.json')
if s:manifest_text is v:null
  call s:Fail('no golden manifest; run bun run frames:generate')
endif
let s:manifest = json_decode(s:manifest_text)

for s:case in s:manifest.cases
  let s:frame = s:ReadFile(s:frames . '/' . s:case.file)
  if s:frame is v:null
    call s:Fail('missing golden frame ' . s:case.file)
  endif
  let [s:ok, s:message] = markdown_viewer#generated#codec#decode_frame(s:frame)
  if !s:ok
    call s:Fail('frame ' . s:case.name . ': ' . string(get(s:message, 'detail', 'decode failed')))
  endif
  if !s:Equal(s:message, s:case.message)
    call s:Fail('frame ' . s:case.name . ': decoded value differs')
  endif
endfor

let s:cases_text = s:ReadFile(s:root . '/packages/editor/tests/discovery-cases.json')
if s:cases_text is v:null
  call s:Fail('missing packages/editor/tests/discovery-cases.json')
endif
let s:discovered = json_decode(s:cases_text).cases

for s:case in s:discovered
  let s:existing = {}
  for s:path in s:case.existing
    let s:existing[s:path] = 1
  endfor
  let s:realpath_map = get(s:case, 'realpath', {})
  let s:Exists = {path -> has_key(s:existing, path)}
  let s:Realpath = {path -> get(s:realpath_map, path, path)}

  let s:found = markdown_viewer#discovery#find({
        \ 'configured': get(s:case, 'configured', v:null),
        \ 'plugin_dir': s:case.plugin_dir,
        \ 'os': s:case.os,
        \ 'arch': s:case.arch,
        \ 'exists': s:Exists,
        \ 'realpath': s:Realpath,
        \ })

  if s:found.ok != s:case.expect.ok
    call s:Fail('discovery ' . s:case.name . ': ok differs')
  endif
  if s:found.ok
    if s:found.command !=# s:case.expect.command
      call s:Fail('discovery ' . s:case.name . ': command differs')
    endif
    if !s:Equal(s:found.args, s:case.expect.args)
      call s:Fail('discovery ' . s:case.name . ': args differ')
    endif
  else
    for s:needle in s:case.expect.contains
      if stridx(s:found.message, s:needle) < 0
        call s:Fail('discovery ' . s:case.name . ': message misses ' . s:needle)
      endif
    endfor
  endif
endfor

let s:refresh_text = s:ReadFile(s:root . '/packages/editor/tests/refresh-cases.json')
if s:refresh_text is v:null
  call s:Fail('missing packages/editor/tests/refresh-cases.json')
endif
let s:refresh_suite = json_decode(s:refresh_text)

function! s:RefreshRead(state, bufnr) abort
  if a:state.step_read is v:null
    return v:null
  endif
  if a:bufnr is v:null || a:bufnr == a:state.step_read.bufnr
    return a:state.step_read
  endif
  return v:null
endfunction

function! s:RefreshSend(state, path, text) abort
  let a:state.attempts += 1
  let l:accepted = 1
  if a:state.send_answers isnot v:null && a:state.attempts <= len(a:state.send_answers)
    let l:accepted = a:state.send_answers[a:state.attempts - 1] ? 1 : 0
  endif
  if l:accepted
    call add(a:state.sends, {'path': a:path, 'text': a:text})
  endif
  return l:accepted
endfunction

function! s:RefreshNow(state) abort
  return a:state.clock
endfunction

function! s:RefreshSchedule(state, ms, fn) abort
  let a:state.timer_seq += 1
  call add(a:state.delays, a:ms)
  call add(a:state.timers, {
        \ 'handle': a:state.timer_seq,
        \ 'due': a:state.clock + a:ms,
        \ 'fn': a:fn,
        \ 'fired': 0,
        \ 'cancelled': 0,
        \ })
  return a:state.timer_seq
endfunction

function! s:RefreshCancel(state, handle) abort
  for l:entry in a:state.timers
    if l:entry.handle == a:handle
      let l:entry.cancelled = 1
    endif
  endfor
endfunction

" Due timers fire before an event at or past their due time, in due order.
function! s:RefreshFireDue(state, limit) abort
  while 1
    let l:best = v:null
    for l:entry in a:state.timers
      if !l:entry.fired && !l:entry.cancelled && l:entry.due <= a:limit
        if l:best is v:null || l:entry.due < l:best.due
              \ || (l:entry.due == l:best.due && l:entry.handle < l:best.handle)
          let l:best = l:entry
        endif
      endif
    endfor
    if l:best is v:null
      return
    endif
    let l:best.fired = 1
    let a:state.clock = l:best.due
    call call(l:best.fn, [])
  endwhile
endfunction

function! s:ReplayRefresh(case, window_ms) abort
  let l:state = {
        \ 'clock': 0,
        \ 'timers': [],
        \ 'timer_seq': 0,
        \ 'sends': [],
        \ 'attempts': 0,
        \ 'delays': [],
        \ 'step_read': get(a:case, 'bind', v:null),
        \ 'send_answers': get(a:case, 'sendAnswers', v:null),
        \ }
  let l:deps = {
        \ 'read': function('s:RefreshRead', [l:state]),
        \ 'send': function('s:RefreshSend', [l:state]),
        \ 'now': function('s:RefreshNow', [l:state]),
        \ 'timer': {
        \   'schedule': function('s:RefreshSchedule', [l:state]),
        \   'cancel': function('s:RefreshCancel', [l:state]),
        \ },
        \ }
  let l:handle = markdown_viewer#refresh#new(l:deps)

  for l:event in a:case.events
    let l:state.clock = l:event.atMs
    call s:RefreshFireDue(l:state, l:state.clock)
    if l:event.kind ==# 'Elapsed'
      continue
    elseif l:event.kind ==# 'Stop'
      call call(l:handle.stop, [])
      if call(l:handle.bound, []) isnot v:null
        call s:Fail('refresh ' . a:case.name . ': stop left the module bound')
      endif
    elseif l:event.kind ==# 'Manual'
      let l:state.step_read = get(l:event, 'read', v:null)
      call call(l:handle.manual, [])
    else
      let l:state.step_read = get(l:event, 'read', v:null)
      let l:subject = get(l:event, 'buf', v:null)
      if l:subject is v:null && l:state.step_read isnot v:null
        let l:subject = l:state.step_read.bufnr
      endif
      if l:subject is v:null && get(a:case, 'bind', v:null) isnot v:null
        let l:subject = a:case.bind.bufnr
      endif
      call call(l:handle.on, [l:event.kind, l:subject])
    endif
  endfor

  let l:message = 'refresh ' . a:case.name . ': '
  for l:entry in l:state.timers
    if !l:entry.fired && !l:entry.cancelled
      call call(l:handle.stop, [])
      call s:Fail(l:message . 'a live timer remains')
    endif
  endfor
  for l:delay in l:state.delays
    if l:delay != a:window_ms
      call call(l:handle.stop, [])
      call s:Fail(l:message . 'timer delay ' . l:delay . ' differs from windowMs')
    endif
  endfor
  if l:state.attempts == 0 && len(l:state.delays) != 0
    call call(l:handle.stop, [])
    call s:Fail(l:message . 'opened a window without an accepted send')
  endif
  let l:schedules = get(a:case.expect, 'schedules', v:null)
  if l:schedules isnot v:null && len(l:state.delays) != l:schedules
    call call(l:handle.stop, [])
    call s:Fail(l:message . 'schedules ' . len(l:state.delays) . ', expected ' . l:schedules)
  endif
  if l:state.attempts != a:case.expect.attempts
    call call(l:handle.stop, [])
    call s:Fail(l:message . 'attempts ' . l:state.attempts . ', expected ' . a:case.expect.attempts)
  endif
  if len(l:state.sends) != len(a:case.expect.sends)
    call call(l:handle.stop, [])
    call s:Fail(l:message . 'sends ' . len(l:state.sends) . ', expected ' . len(a:case.expect.sends))
  endif
  let l:index = 0
  while l:index < len(a:case.expect.sends)
    let l:actual = l:state.sends[l:index]
    let l:expected = a:case.expect.sends[l:index]
    if !s:Equal(l:actual.path, l:expected.path) || !s:Equal(l:actual.text, l:expected.text)
      call call(l:handle.stop, [])
      call s:Fail(l:message . 'send ' . (l:index + 1) . ' differs')
    endif
    let l:index += 1
  endwhile
  call call(l:handle.stop, [])
endfunction

for s:refresh_case in s:refresh_suite.cases
  call s:ReplayRefresh(s:refresh_case, s:refresh_suite.windowMs)
endfor

call s:Out(
      \ printf(
      \   'OK vim conformance (%d frames, %d discovery cases, %d refresh cases)',
      \   len(s:manifest.cases),
      \   len(s:discovered),
      \   len(s:refresh_suite.cases)))
qall!

" The cursor case replay shared by the Vim conformance run and the driver.

function! s:Equal(left, right) abort
  if type(a:left) != type(a:right)
    return 0
  endif
  if type(a:left) == v:t_list
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

function! s:NormalizeWith(overrides) abort
  let l:result = {'values': {}, 'sources': {}}
  for l:key in markdown_viewer#generated#config#get().keys
    let l:result.values[l:key.name] = deepcopy(l:key.default)
    let l:result.sources[l:key.name] = 'default'
  endfor
  for [l:name, l:cell] in items(a:overrides)
    let l:result.values[l:name] = l:cell.value
    let l:result.sources[l:name] = l:cell.source
  endfor
  return l:result
endfunction

function! s:Job(state, opts) abort
  let a:state.next += 1
  let l:id = a:state.next
  let a:state.jobs[l:id] = {'opts': a:opts}
  let l:ready = markdown_viewer#generated#codec#encode_frame({
        \ '_tag': 'ready',
        \ 'editorProtocolVersion': markdown_viewer#generated#codec#version(),
        \ 'sessionId': 'session',
        \ 'url': 'http://127.0.0.1:1/',
        \ })
  call call(a:opts.out_cb, [l:id, l:ready])
  return l:id
endfunction

function! s:Send(state, frame) abort
  let [l:ok, l:message] = markdown_viewer#generated#codec#decode_frame(a:frame)
  if !l:ok || l:message._tag ==# 'configuration'
    return 1
  endif
  call add(a:state.order, l:message._tag)
  if l:message._tag ==# 'cursor'
    call add(a:state.cursors, {'line': l:message.line, 'fraction': l:message.fraction})
  endif
  return 1
endfunction

function! CursorReplayRun(case) abort
  let l:overrides = {}
  let l:buffers = {}
  let l:notifications = []
  let l:state = {
        \ 'next': 0,
        \ 'jobs': {},
        \ 'order': [],
        \ 'cursors': [],
        \ 'notifications': l:notifications,
        \ 'position': {'line': 1, 'fraction': 0},
        \ }
  let l:effects = {}
  let l:effects.notify = {text -> add(l:notifications, text)}
  let l:effects.job_start = {cmd, opts -> s:Job(l:state, opts)}
  let l:effects.send = {job, frame -> s:Send(l:state, frame)}
  let l:effects.close_stdin = {job -> 0}
  let l:effects.job_stop = {job -> 0}
  let l:effects.open = {url -> 0}
  let l:effects.defer = {fn, ms -> call(fn, [])}
  let l:effects.timer_start = {ms, fn -> 1}
  let l:effects.timer_stop = {handle -> 0}
  let l:effects.now = {-> 0}
  let l:effects.create_group = {name -> name}
  let l:effects.clear_group = {name -> 0}
  let l:effects.create_autocmd = {event, opts -> 0}
  let l:effects.current_buf = {-> 1}
  let l:effects.cursor = {-> l:state.position}
  let l:effects.buf_name = {buf -> get(get(l:buffers, buf, {}), 'path', '/tmp/' . buf . '.md')}
  let l:effects.buf_lines = {buf -> split(get(get(l:buffers, buf, {}), 'text', ''), "\n", 1)}
  let l:effects.buf_valid = {buf -> has_key(l:buffers, buf) || buf <= 3}
  let l:effects.log_path = {-> '/tmp/markdown-viewer.log'}
  let l:effects.normalize = {-> s:NormalizeWith(l:overrides)}
  let l:effects.discovery = {opts -> {'ok': 1, 'command': 'bun', 'args': []}}

  let l:handle = markdown_viewer#session#new(l:effects)

  for l:event in a:case.events
    if l:event._tag ==# 'start'
      let l:buffers[l:event.buf] = {'bufnr': l:event.buf, 'path': l:event.path, 'text': l:event.text}
      call call(l:handle.preview, [l:event.buf])
    elseif l:event._tag ==# 'cursor'
      let l:buffer = get(l:buffers, l:event.buf, {})
      if has_key(l:event, 'text')
        let l:buffer.text = l:event.text
      endif
      let l:state.position = {
            \ 'line': get(l:event, 'line', 1),
            \ 'fraction': get(l:event, 'fraction', 0),
            \ }
      if has_key(l:event, 'enabled')
        let l:overrides['scroll.enabled'] = {
              \ 'value': l:event.enabled,
              \ 'source': 'setup:scroll.enabled',
              \ }
        call call(l:handle.config_changed, [])
      endif
      call call(l:handle.on, [get(l:event, 'kind', 'CursorMoved'), l:event.buf])
    elseif l:event._tag ==# 'rebind'
      call call(l:handle.rebind, [l:event.buf])
    elseif l:event._tag ==# 'config'
      for [l:name, l:cell] in items(l:event.values)
        let l:overrides[l:name] = l:cell
      endfor
      call call(l:handle.config_changed, [])
    endif
  endfor

  let l:expect = a:case.expect
  if has_key(l:expect, 'order') && !s:Equal(l:state.order, l:expect.order)
    return [0, 'order ' . string(l:state.order)]
  endif
  if has_key(l:expect, 'cursors') && len(l:state.cursors) != l:expect.cursors
    return [0, 'cursors ' . len(l:state.cursors)]
  endif
  if has_key(l:expect, 'lastCursor')
    if empty(l:state.cursors)
      return [0, 'no cursor']
    endif
    let l:last = l:state.cursors[-1]
    if l:last.line != l:expect.lastCursor.line
          \ || abs(l:last.fraction - l:expect.lastCursor.fraction) > 0.000000001
      return [0, 'last cursor ' . string(l:last)]
    endif
  endif
  if has_key(l:expect, 'notifications')
    let l:joined = join(l:notifications, "\n")
    for l:needle in l:expect.notifications
      if stridx(l:joined, l:needle) < 0
        return [0, 'no notification names ' . l:needle]
      endif
    endfor
  endif
  return [1, '']
endfunction

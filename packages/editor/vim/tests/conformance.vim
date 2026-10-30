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

function! s:IsNull(value) abort
  return type(a:value) == v:t_none
endfunction

function! s:Same(left, right) abort
  if s:IsNull(a:left) && s:IsNull(a:right)
    return 1
  endif
  if s:IsNull(a:left) || s:IsNull(a:right)
    return 0
  endif
  return s:Equal(a:left, a:right)
endfunction

function! s:ConfigContains(list, value) abort
  return index(a:list, a:value) >= 0
endfunction

function! s:ConfigUnset(name) abort
  if has_key(g:, a:name)
    call remove(g:, a:name)
  endif
endfunction

function! s:ConfigVariable(vim_name) abort
  return a:vim_name[2:]
endfunction

function! s:ResetCarriers() abort
  for l:key in markdown_viewer#generated#config#get().keys
    call s:ConfigUnset(s:ConfigVariable(l:key.vim_name))
    if !s:IsNull(l:key.alias) && l:key.alias_scope ==# 'global'
      call s:ConfigUnset('mkdp_' . l:key.alias)
    endif
  endfor
  call s:ConfigUnset('mkdp_preview_options')
endfunction

function! s:ConfigNotify(state, text) abort
  call add(a:state.notified, a:text)
endfunction

function! s:ConfigReadG(name) abort
  return get(g:, a:name, v:null)
endfunction

function! s:ReplayConfig(case) abort
  if has_key(a:case, 'editors') && !s:ConfigContains(a:case.editors, 'vim')
    call s:Out('SKIP config ' . a:case.name . ': not for vim')
    return 0
  endif

  call s:ResetCarriers()
  let l:settings = get(a:case, 'settings', {})
  call extend(g:, get(l:settings, 'g', {}))
  let l:nvim = get(l:settings, 'nvim', {})
  call extend(g:, get(l:nvim, 'g', {}))
  let l:setup = get(l:nvim, 'setup', {})

  let l:state = {'notified': []}
  let l:deps = {
        \ 'notify': function('s:ConfigNotify', [l:state]),
        \ 'warned': {},
        \ 'g': function('s:ConfigReadG'),
        \ }
  let l:normalized = markdown_viewer#config#normalize(l:setup, l:deps)
  let l:normalized = markdown_viewer#config#normalize(l:setup, l:deps)

  let l:expected_values = get(a:case.expect, 'values', {})
  for [l:name, l:value] in items(l:expected_values)
    if !s:Same(get(l:normalized.values, l:name, v:null), l:value)
      call s:Fail('config ' . a:case.name . ': value ' . l:name . ' differs')
    endif
  endfor

  let l:expected_sources = get(a:case.expect, 'sources', {})
  if has_key(l:expected_sources, 'vim')
    let l:expected_sources = l:expected_sources.vim
  endif
  for [l:name, l:source] in items(l:expected_sources)
    if get(l:normalized.sources, l:name, '') !=# l:source
      call s:Fail('config ' . a:case.name . ': source ' . l:name . ' differs')
    endif
  endfor

  for l:key in markdown_viewer#generated#config#get().keys
    if !l:key.container && !has_key(l:expected_values, l:key.name)
      if !s:Same(get(l:normalized.values, l:key.name, v:null), l:key.default)
        call s:Fail('config ' . a:case.name . ': default ' . l:key.name . ' differs')
      endif
      if get(l:normalized.sources, l:key.name, '') !=# 'default'
        call s:Fail('config ' . a:case.name . ': default source ' . l:key.name . ' differs')
      endif
    endif
  endfor

  for l:name in get(a:case.expect, 'noValue', [])
    if has_key(l:normalized.values, l:name) || has_key(l:normalized.sources, l:name)
      call s:Fail('config ' . a:case.name . ': ' . l:name . ' carries a value')
    endif
  endfor

  let l:expected_warnings = get(a:case.expect, 'warnings', 0)
  if len(l:state.notified) != l:expected_warnings
    call s:Fail(
          \ 'config ' . a:case.name . ': warnings ' . len(l:state.notified)
          \ . ', expected ' . l:expected_warnings)
  endif

  if has_key(a:case.expect, 'message')
    let l:found = 0
    for l:message in l:state.notified
      if l:message ==# a:case.expect.message
        let l:found = 1
        break
      endif
    endfor
    if !l:found
      call s:Fail('config ' . a:case.name . ': the four-field message differs')
    endif
  endif

  if has_key(a:case.expect, 'messageContains')
    let l:matched = 0
    for l:message in l:state.notified
      let l:all = 1
      for l:needle in a:case.expect.messageContains
        if stridx(l:message, l:needle) < 0
          let l:all = 0
          break
        endif
      endfor
      if l:all
        let l:matched = 1
        break
      endif
    endfor
    if !l:matched
      call s:Fail('config ' . a:case.name . ': no message names every expected field')
    endif
  endif

  let l:groups = markdown_viewer#config#split(l:normalized)
  for l:key in markdown_viewer#generated#config#get().keys
    if !l:key.container
      let l:group = l:key.class ==# 'page-display' ? 'display' : l:key.class
      if !has_key(l:groups, l:group)
        call s:Fail('config ' . a:case.name . ': no group ' . l:group)
      endif
      if !s:Same(
            \ get(l:groups[l:group], l:key.name, v:null),
            \ get(l:normalized.values, l:key.name, v:null))
        call s:Fail('config ' . a:case.name . ': group ' . l:group . ' misses ' . l:key.name)
      endif
    endif
  endfor

  let l:frame_index = 0
  for l:key in markdown_viewer#generated#config#get().keys
    if !l:key.container && (l:key.class ==# 'render' || l:key.class ==# 'page-display')
      let l:value = get(l:normalized.values, l:key.name, v:null)
      let l:source = get(l:normalized.sources, l:key.name, 'default')
      if l:source !=# 'default' && !s:IsNull(l:value)
        if l:frame_index >= len(l:groups.frame)
          call s:Fail('config ' . a:case.name . ': frame misses ' . l:key.name)
        endif
        let l:entry = l:groups.frame[l:frame_index]
        if l:entry.key !=# l:key.name || l:entry.source !=# l:source
              \ || !s:Same(l:entry.value, l:value)
          call s:Fail('config ' . a:case.name . ': frame entry ' . l:key.name . ' differs')
        endif
        let l:frame_index += 1
      endif
    endif
  endfor
  if len(l:groups.frame) != l:frame_index
    call s:Fail('config ' . a:case.name . ': frame has extra entries')
  endif

  if strlen(markdown_viewer#config#hash(l:normalized)) != 64
    call s:Fail('config ' . a:case.name . ': hash is not sha256')
  endif

  return 1
endfunction

let s:config_text = s:ReadFile(s:root . '/packages/editor/tests/config-cases.json')
if s:config_text is v:null
  call s:Fail('missing packages/editor/tests/config-cases.json')
endif
let s:config_ran = 0
for s:config_case in json_decode(s:config_text).cases
  if s:ReplayConfig(s:config_case)
    let s:config_ran += 1
    call s:Out('OK config ' . s:config_case.name)
  endif
endfor

call s:ResetCarriers()

function! s:IsPluginLoaded() abort
  return exists('g:loaded_markdown_viewer')
endfunction

function! s:ResetPlugin() abort
  unlet! g:loaded_markdown_viewer
  for l:name in ['MarkdownPreview', 'MarkdownPreviewStop', 'MarkdownPreviewToggle']
    execute 'silent! delcommand ' . l:name
  endfor
  for l:name in s:plug_names
    execute 'silent! nunmap ' . l:name
    execute 'silent! iunmap ' . l:name
  endfor
  for l:name in ['markdown_viewer_filetypes', 'markdown_viewer_command_for_global', 'mkdp_filetypes', 'mkdp_command_for_global']
    if has_key(g:, l:name)
      call remove(g:, l:name)
    endif
  endfor
  augroup markdown_viewer_filetype
    autocmd!
  augroup END
endfunction

function! s:CommandsExist() abort
  return exists(':MarkdownPreview') == 2
endfunction

function! s:MapsExist() abort
  for l:name in s:plug_names
    if maparg(l:name, 'n') ==# '' || maparg(l:name, 'i') ==# ''
      return 0
    endif
  endfor
  return 1
endfunction

function! s:ReplayLoad(case) abort
  if has_key(a:case, 'editors') && !s:ConfigContains(a:case.editors, 'vim')
    call s:Out('SKIP load ' . a:case.name . ': not for vim')
    return 0
  endif

  call s:ResetPlugin()

  if get(a:case.expect, 'conflict', 0)
    let l:temp = tempname()
    call mkdir(l:temp . '/plugin', 'p')
    call writefile(['" baseline plugin'], l:temp . '/plugin/mkdp.vim')
    let l:saved = &runtimepath
    let &runtimepath = l:temp . ',' . l:saved
    messages clear
    execute 'source ' . fnameescape(s:plugin_path)
    redir => l:captured
    silent messages
    redir END
    let &runtimepath = l:saved
    call delete(l:temp, 'rf')

    if stridx(l:captured, l:temp) < 0 || stridx(l:captured, s:plugin_dir) < 0
      call s:Fail('load ' . a:case.name . ': no message names both directories')
    endif
    if s:CommandsExist()
      call s:Fail('load ' . a:case.name . ': commands exist after the conflict')
    endif
    call s:Out('OK load ' . a:case.name)
    return 1
  endif

  if get(a:case.expect, 'floor', 0)
    let l:floor = markdown_viewer#messages#floor()
    if stridx(l:floor, '8.2.1978') < 0
      call s:Fail('load ' . a:case.name . ': the floor message changed')
    endif
    call s:Out('vim patch-8.2.1978: ' . (has('patch-8.2.1978') ? 1 : 0))
    call s:Out('OK load ' . a:case.name)
    return 1
  endif

  call extend(g:, {
        \ 'markdown_viewer_filetypes': a:case.filetypes,
        \ 'markdown_viewer_command_for_global': a:case.global ? v:true : v:false,
        \ })
  enew
  execute 'set filetype=' . a:case.filetype
  execute 'source ' . fnameescape(s:plugin_path)
  doautocmd FileType

  if s:CommandsExist() != (a:case.expect.commands ? 1 : 0)
    call s:Fail('load ' . a:case.name . ': commands differ')
  endif
  if has_key(a:case.expect, 'maps') && s:MapsExist() != (a:case.expect.maps ? 1 : 0)
    call s:Fail('load ' . a:case.name . ': maps differ')
  endif

  if get(a:case.expect, 'staleCommands', 0)
    let g:markdown_viewer_filetypes = ['text']
    if !s:CommandsExist()
      call s:Fail('load ' . a:case.name . ': the old buffer lost its commands')
    endif
    enew
    set filetype=markdown
    if s:CommandsExist()
      call s:Fail('load ' . a:case.name . ': a new buffer gained commands')
    endif
  endif

  call s:Out('OK load ' . a:case.name)
  return 1
endfunction

let s:plugin_path = s:root . '/packages/editor/vim/plugin/markdown_viewer.vim'
let s:plugin_dir = s:root . '/packages/editor/vim'
let s:plug_names = [
      \ '<Plug>(MarkdownPreview)',
      \ '<Plug>(MarkdownPreviewStop)',
      \ '<Plug>(MarkdownPreviewToggle)',
      \ ]
let s:load_text = s:ReadFile(s:root . '/packages/editor/tests/load-cases.json')
if s:load_text is v:null
  call s:Fail('missing packages/editor/tests/load-cases.json')
endif
let s:load_ran = 0
for s:load_case in json_decode(s:load_text).cases
  if s:ReplayLoad(s:load_case)
    let s:load_ran += 1
  endif
endfor

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

function! s:SessionJob(state, cmd, opts) abort
  let a:state.next += 1
  let l:id = a:state.next
  let a:state.jobs[l:id] = {'opts': a:opts}
  let a:state.commands[l:id] = a:cmd
  let a:state.sends[l:id] = []
  if a:state.ready
    let l:ready = markdown_viewer#generated#codec#encode_frame({
          \ '_tag': 'ready',
          \ 'editorProtocolVersion': markdown_viewer#generated#codec#version(),
          \ 'sessionId': 'session',
          \ 'url': 'http://127.0.0.1:1/',
          \ })
    call call(a:opts.out_cb, [l:id, l:ready])
  endif
  return l:id
endfunction

function! s:SessionSend(state, job, frame) abort
  let [l:ok, l:message] = markdown_viewer#generated#codec#decode_frame(a:frame)
  if !l:ok
    return 0
  endif
  let l:key = string(a:job)
  let a:state.sends[l:key] = add(get(a:state.sends, l:key, []), l:message._tag)
  if l:message._tag ==# 'configuration'
    let a:state.configurations += 1
  endif
  return 1
endfunction

function! s:SessionOpen(state, url) abort
  let a:state.opened += 1
endfunction

function! s:SessionClose(state, job) abort
  let a:state.closed += 1
endfunction

function! s:SessionAutocmd(state, event, opts) abort
  if !has_key(a:state.autocmds, a:event)
    let a:state.autocmds[a:event] = {}
  endif
  let l:buf = a:opts.bufnr
  if !has_key(a:state.autocmds[a:event], l:buf)
    let a:state.autocmds[a:event][l:buf] = []
  endif
  call add(a:state.autocmds[a:event][l:buf], a:opts)
endfunction

function! s:ReplaySession(case) abort
  let l:overrides = {}
  let l:buffers = {}
  let l:state = {
        \ 'next': 0,
        \ 'ready': get(a:case, 'ready', 1),
        \ 'jobs': {},
        \ 'sends': {},
        \ 'opened': 0,
        \ 'closed': 0,
        \ 'configurations': 0,
        \ 'autocmds': {},
        \ 'commands': {},
        \ }
  let l:notifications = []

  let l:effects = {}
  let l:effects.notify = {text -> add(l:notifications, text)}
  let l:effects.job_start = {cmd, opts -> s:SessionJob(l:state, cmd, opts)}
  let l:effects.send = {job, frame -> s:SessionSend(l:state, job, frame)}
  let l:effects.close_stdin = {job -> s:SessionClose(l:state, job)}
  let l:effects.job_stop = {job -> 0}
  let l:effects.open = {url -> s:SessionOpen(l:state, url)}
  let l:effects.open_named = {name, url -> s:SessionOpen(l:state, url)}
  let l:effects.call_function = {name, url -> s:SessionOpen(l:state, url)}
  let l:effects.defer = {fn, ms -> call(fn, [])}
  let l:effects.timer_start = {ms, fn -> 1}
  let l:effects.timer_stop = {handle -> 0}
  let l:effects.now = {-> 0}
  let l:effects.create_group = {name -> name}
  let l:effects.clear_group = {name -> 0}
  let l:effects.create_autocmd = {event, opts -> s:SessionAutocmd(l:state, event, opts)}
  let l:effects.current_buf = {-> 1}
  let l:effects.buf_name = {buf -> get(get(l:buffers, buf, {}), 'path', '/tmp/' . buf . '.md')}
  let l:effects.buf_lines = {buf -> split(get(get(l:buffers, buf, {}), 'text', ''), "\n", 1)}
  let l:effects.buf_valid = {buf -> has_key(l:buffers, buf) || buf <= 3}
  let l:effects.cursor = {-> {'line': 1, 'fraction': 0}}
  let l:effects.loaded_bufs = {-> keys(l:buffers)}
  let l:effects.log_path = {-> '/tmp/markdown-viewer.log'}
  let l:effects.normalize = {-> s:NormalizeWith(l:overrides)}
  let l:effects.discovery = {opts -> {'ok': 1, 'command': 'bun', 'args': []}}

  let l:handle = markdown_viewer#session#new(l:effects)

  for l:event in a:case.events
    if l:event._tag ==# 'start'
      let l:buffers[l:event.buf] = {'bufnr': l:event.buf, 'path': l:event.path, 'text': l:event.text}
      call call(l:handle.preview, [l:event.buf])
    elseif l:event._tag ==# 'stop'
      call call(l:handle.stop, [l:event.buf])
    elseif l:event._tag ==# 'hidden'
      for l:opts in get(get(l:state.autocmds, 'BufHidden', {}), l:event.buf, [])
        call call(l:opts.callback, [])
      endfor
    elseif l:event._tag ==# 'exit'
      call call(l:state.jobs[l:event.job].opts.exit_cb, [l:event.job, l:event.code])
    elseif l:event._tag ==# 'auto'
      let l:buffers[l:event.buf] = {'bufnr': l:event.buf, 'path': l:event.path, 'text': l:event.text}
      call call(l:handle.auto_start, [l:event.buf])
    elseif l:event._tag ==# 'load'
      let l:buffers[l:event.buf] = {'bufnr': l:event.buf, 'path': l:event.path, 'text': l:event.text}
    elseif l:event._tag ==# 'enter'
      call call(l:handle.enter, [l:event.buf])
    elseif l:event._tag ==# 'unload'
      call remove(l:buffers, l:event.buf)
    elseif l:event._tag ==# 'text'
      let l:buffers[l:event.buf].text = l:event.text
    elseif l:event._tag ==# 'preview'
      call call(l:handle.preview, [l:event.buf])
    elseif l:event._tag ==# 'stop_all'
      call call(l:handle.stop_all, [])
    elseif l:event._tag ==# 'config'
      for [l:name, l:cell] in items(l:event.values)
        let l:overrides[l:name] = l:cell
      endfor
      call call(l:handle.config_changed, [])
    endif
  endfor

  let l:rows = sort(map(keys(call(l:handle.rows, [])), 'str2nr(v:val)'), 'n')
  let l:expect = a:case.expect
  if !s:Equal(l:rows, l:expect.rows)
    call s:Fail('session ' . a:case.name . ': rows differ')
  endif
  if l:state.opened != l:expect.opened || l:state.closed != l:expect.closed
    call s:Fail('session ' . a:case.name . ': open/close counts differ')
  endif
  if has_key(l:expect, 'configurations') && l:state.configurations != l:expect.configurations
    call s:Fail('session ' . a:case.name . ': configuration count differs')
  endif
  if has_key(l:expect, 'sends')
    for [l:job, l:tags] in items(l:expect.sends)
      if !s:Equal(get(l:state.sends, l:job, []), l:tags)
        call s:Fail('session ' . a:case.name . ': job ' . l:job . ' sends differ')
      endif
    endfor
  endif
  if has_key(l:expect, 'jobs') && l:state.next != l:expect.jobs
    call s:Fail('session ' . a:case.name . ': job count differs')
  endif
  if has_key(l:expect, 'ports')
    for [l:job, l:port] in items(l:expect.ports)
      let l:cmd = get(l:state.commands, str2nr(l:job), [])
      let l:found = v:null
      let l:index = 0
      while l:index < len(l:cmd)
        if l:cmd[l:index] ==# '--port'
          let l:found = l:cmd[l:index + 1]
        endif
        let l:index += 1
      endwhile
      if l:found !=# l:port
        call s:Fail('session ' . a:case.name . ': port ' . l:job . ' differs')
      endif
    endfor
  endif
  if has_key(l:expect, 'notifications')
    let l:joined = join(l:notifications, "\n")
    for l:needle in l:expect.notifications
      if stridx(l:joined, l:needle) < 0
        call s:Fail('session ' . a:case.name . ': no notification names ' . l:needle)
      endif
    endfor
  endif
  return 1
endfunction

execute 'source ' . fnameescape(s:root . '/packages/editor/tests/cursor-replay.vim')
let s:cursor_text = s:ReadFile(s:root . '/packages/editor/tests/cursor-cases.json')
if s:cursor_text is v:null
  call s:Fail('missing packages/editor/tests/cursor-cases.json')
endif
let s:cursor_suite = json_decode(s:cursor_text)
let s:cursor_ran = 0
for s:cursor_case in s:cursor_suite.cases
  let [s:ok, s:why] = CursorReplayRun(s:cursor_case)
  if !s:ok
    call s:Fail('cursor ' . s:cursor_case.name . ': ' . s:why)
  endif
  let s:cursor_ran += 1
  call s:Out('OK cursor ' . s:cursor_case.name)
endfor
for s:fraction in s:cursor_suite.fractions
  let s:actual = markdown_viewer#session#cursor_fraction(s:fraction.winline, s:fraction.winheight)
  if abs(s:actual - s:fraction.fraction) > 0.000000001
    call s:Fail('fraction ' . s:fraction.winline . '/' . s:fraction.winheight . ' differs')
  endif
endfor
call s:Out('OK cursor fractions')

let s:session_text = s:ReadFile(s:root . '/packages/editor/tests/session-cases.json')
if s:session_text is v:null
  call s:Fail('missing packages/editor/tests/session-cases.json')
endif
let s:session_ran = 0
for s:session_case in json_decode(s:session_text).cases
  if s:ReplaySession(s:session_case)
    let s:session_ran += 1
    call s:Out('OK session ' . s:session_case.name)
  endif
endfor

let s:opener_text = s:ReadFile(s:root . '/packages/editor/tests/opener-cases.json')
if s:opener_text is v:null
  call s:Fail('missing packages/editor/tests/opener-cases.json')
endif
let s:opener_ran = 0
for s:opener_case in json_decode(s:opener_text).cases
  if s:ReplaySession(s:opener_case)
    let s:opener_ran += 1
    call s:Out('OK opener ' . s:opener_case.name)
  endif
endfor

call s:Out(
      \ printf(
      \   'OK vim conformance (%d frames, %d discovery cases, %d refresh cases, %d config cases, %d load cases, %d session cases, %d opener cases, %d cursor cases)',
      \   len(s:manifest.cases),
      \   len(s:discovered),
      \   len(s:refresh_suite.cases),
      \   s:config_ran,
      \   s:load_ran,
      \   s:session_ran,
      \   s:opener_ran,
      \   s:cursor_ran))
cquit 0

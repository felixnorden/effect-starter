" The same row table, teardown, timeout, and messages as the Neovim adapter.
" One handle owns the buffer→row dictionary; the module functions delegate to a
" production handle built from the default effects.

let s:START_TIMEOUT_MS = 5000
let s:EXIT_GRACE_MS = 500
let s:default = v:null
let s:callbacks = {}
let s:groups = {}

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
  let s:log_counter = get(s:, 'log_counter', 0) + 1
  return printf('%s/%d-%d-%d.log', l:dir, getpid(), localtime(), s:log_counter)
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

function! s:CurrentBuf() abort
  return bufnr('%')
endfunction

function! markdown_viewer#session#cursor_fraction(winline, winheight) abort
  let l:fraction = (a:winline - 1) * 1.0 / max([1, a:winheight - 1])
  return min([1.0, max([0.0, l:fraction])])
endfunction

function! s:Cursor() abort
  return {
        \ 'line': line('.'),
        \ 'fraction': markdown_viewer#session#cursor_fraction(
        \   winline(), winheight(0)),
        \ }
endfunction

function! s:BufName(bufnr) abort
  return bufname(a:bufnr)
endfunction

function! s:BufLines(bufnr) abort
  return getbufline(a:bufnr, 1, '$')
endfunction

function! s:BufValid(bufnr) abort
  return bufexists(a:bufnr) && bufloaded(a:bufnr)
endfunction

function! s:LoadedBufs() abort
  return map(getbufinfo({'bufloaded': 1}), 'v:val.bufnr')
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

function! s:OpenNamed(name, url) abort
  if has('win32') || has('win64')
    let l:cmd = ['cmd', '/c', 'start', '', a:name, a:url]
  elseif has('macunix')
    let l:cmd = ['open', '-a', a:name, a:url]
  else
    let l:cmd = [a:name, a:url]
  endif
  call job_start(l:cmd)
endfunction

function! s:CallFunction(name, url) abort
  if exists('*' . a:name)
    call call(a:name, [a:url])
  endif
endfunction

function! s:Notify(text) abort
  echohl ErrorMsg
  echomsg a:text
  echohl None
endfunction

function! s:JobStart(cmd, opts) abort
  return job_start(a:cmd, a:opts)
endfunction

function! s:JobStop(job) abort
  try
    call job_stop(a:job)
  catch
  endtry
endfunction

function! s:Defer(fn, ms) abort
  if exists('*timer_start')
    call timer_start(a:ms, {-> call(a:fn, [])})
  endif
endfunction

function! s:CreateGroup(name) abort
  if !has_key(s:groups, a:name)
    let s:groups[a:name] = 1
    execute 'augroup ' . a:name
    autocmd!
    augroup END
  endif
  return a:name
endfunction

function! s:ClearGroup(name) abort
  execute 'augroup ' . a:name
  autocmd!
  augroup END
endfunction

function! s:CreateAutocmd(event, opts) abort
  let l:key = a:opts.group . ':' . a:event . ':' . a:opts.bufnr
  let s:callbacks[l:key] = a:opts.callback
  execute 'augroup ' . a:opts.group
  execute printf(
        \ 'autocmd %s <buffer=%d> call markdown_viewer#session#fire(%s)',
        \ a:event,
        \ a:opts.bufnr,
        \ string(l:key))
  augroup END
endfunction

function! markdown_viewer#session#fire(key) abort
  if has_key(s:callbacks, a:key)
    call call(s:callbacks[a:key], [])
  endif
endfunction

function! s:DefaultEffects() abort
  return {
        \ 'notify': function('s:Notify'),
        \ 'job_start': function('s:JobStart'),
        \ 'send': function('markdown_viewer#frames#send'),
        \ 'close_stdin': function('markdown_viewer#frames#close_stdin'),
        \ 'job_stop': function('s:JobStop'),
        \ 'open': function('s:Open'),
        \ 'open_named': function('s:OpenNamed'),
        \ 'call_function': function('s:CallFunction'),
        \ 'defer': function('s:Defer'),
        \ 'timer_start': function('s:Schedule'),
        \ 'timer_stop': function('s:CancelTimer'),
        \ 'now': function('s:Now'),
        \ 'create_group': function('s:CreateGroup'),
        \ 'clear_group': function('s:ClearGroup'),
        \ 'create_autocmd': function('s:CreateAutocmd'),
        \ 'current_buf': function('s:CurrentBuf'),
        \ 'cursor': function('s:Cursor'),
        \ 'buf_name': function('s:BufName'),
        \ 'buf_lines': function('s:BufLines'),
        \ 'buf_valid': function('s:BufValid'),
        \ 'loaded_bufs': function('s:LoadedBufs'),
        \ 'log_path': function('s:LogPath'),
        \ 'normalize': function('markdown_viewer#init#get'),
        \ 'discovery': function('markdown_viewer#discovery#find'),
        \ }
endfunction

function! s:IsNull(value) abort
  return type(a:value) == v:t_none
endfunction

function! s:EncodeDocument(row, path, text) abort
  if a:path ==# ''
    call call(a:row.report, [markdown_viewer#messages#unnamed()])
    return v:null
  endif
  let l:max = markdown_viewer#generated#wire#get().max_frame_bytes
  if strlen(a:text) >= l:max
    call call(a:row.report, [markdown_viewer#messages#oversize(l:max)])
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
    call call(a:row.report, [markdown_viewer#messages#oversize(l:max)])
    return v:null
  endif
  return l:frame
endfunction

" Only sendable classes, only non-default, non-nil values, declaration order.
function! s:ConfigurationEntries(normalized) abort
  let l:entries = []
  for l:key in markdown_viewer#generated#config#get().keys
    if l:key.class ==# 'render' || l:key.class ==# 'page-display'
      let l:value = get(a:normalized.values, l:key.name, v:null)
      let l:source = get(a:normalized.sources, l:key.name, 'default')
      if l:source !=# 'default' && !s:IsNull(l:value)
        call add(l:entries, {'key': l:key.name, 'value': l:value, 'source': l:source})
      endif
    endif
  endfor
  return l:entries
endfunction

function! s:ConfigurationFrame(row) abort
  return markdown_viewer#generated#codec#encode_frame({
        \ '_tag': 'configuration',
        \ 'editorProtocolVersion': markdown_viewer#generated#codec#version(),
        \ 'values': s:ConfigurationEntries(a:row.config),
        \ })
endfunction

function! s:SendConfiguration(row) abort
  if a:row.job is v:null
    return 0
  endif
  return call(a:row.effects.send, [a:row.job, s:ConfigurationFrame(a:row)])
endfunction

" A changed setting applies now when the class is sendable; editor and endpoint
" classes report once and wait for the next start (G-42).
function! s:SyncConfiguration(row) abort
  let l:normalized = call(a:row.effects.normalize, [])
  " Hash the complete sendable set so a removed key also counts as a change.
  let l:changed = markdown_viewer#config#hash(l:normalized)
        \ !=# markdown_viewer#config#hash(a:row.config)

  for l:key in markdown_viewer#generated#config#get().keys
    if l:key.class ==# 'editor' || l:key.class ==# 'endpoint'
      let l:current = get(l:normalized.values, l:key.name, v:null)
      let l:before = get(a:row.config.values, l:key.name, v:null)
      let l:source = get(l:normalized.sources, l:key.name, 'default')
      if !s:IsNull(l:current) && l:source !=# 'default'
            \ && l:current != l:before
        let l:text = printf(
              \ 'Markdown Viewer: %s applies at the next start.',
              \ l:key.name)
        let l:seen = get(a:row.reported, l:key.name, v:null)
        if l:seen is v:null || l:seen !=# string(l:current)
          let a:row.reported[l:key.name] = string(l:current)
          call call(a:row.effects.notify, [l:text])
        endif
      endif
    endif
  endfor

  let a:row.config = l:normalized
  if !l:changed
    return
  endif
  if s:SendConfiguration(a:row)
    let a:row.last_reported = v:null
  endif
endfunction

function! s:ReadBuffer(effects, bufnr) abort
  let l:bufnr = a:bufnr is v:null ? call(a:effects.current_buf, []) : a:bufnr
  if !call(a:effects.buf_valid, [l:bufnr])
    return v:null
  endif
  let l:name = call(a:effects.buf_name, [l:bufnr])
  if l:name ==# ''
    return v:null
  endif
  return {
        \ 'bufnr': l:bufnr,
        \ 'path': fnamemodify(l:name, ':p'),
        \ 'text': join(call(a:effects.buf_lines, [l:bufnr]), "\n") . "\n",
        \ }
endfunction

function! s:SendCursor(row) abort
  if a:row.job is v:null || a:row.state !=# 'open'
    return 0
  endif
  if a:row.config isnot v:null
        \ && get(a:row.config.values, 'scroll.enabled', v:true) is v:false
    return 0
  endif
  let l:position = call(a:row.effects.cursor, [])
  if l:position is v:null
    return 0
  endif
  let l:frame = markdown_viewer#generated#codec#encode_frame({
        \ '_tag': 'cursor',
        \ 'editorProtocolVersion': markdown_viewer#generated#codec#version(),
        \ 'line': l:position.line,
        \ 'fraction': l:position.fraction,
        \ })
  return call(a:row.effects.send, [a:row.job, l:frame])
endfunction

function! s:Transmit(row, read) abort
  let l:frame = s:EncodeDocument(a:row, a:read.path, a:read.text)
  if l:frame is v:null
    return 0
  endif
  if !call(a:row.effects.send, [a:row.job, l:frame])
    call call(a:row.report, [
          \ markdown_viewer#messages#dead_server(a:row.log, 'closed')])
    call call(a:row.teardown, [v:null])
    return 0
  endif
  return 1
endfunction

function! s:EndpointRefusal(normalized) abort
  if get(a:normalized.values, 'server.open_to_the_world', v:false) is v:true
    return 'Markdown Viewer: refusing to open the preview to the world. PT-5 keeps the endpoint on loopback.'
  endif
  let l:host = get(a:normalized.values, 'server.open_ip', '')
  if type(l:host) == v:t_string && l:host !=# ''
        \ && l:host !=# '127.0.0.1' && l:host !=# 'localhost' && l:host !=# '::1'
    return printf(
          \ 'Markdown Viewer: refusing non-loopback host %s. PT-5 keeps the endpoint on loopback.',
          \ l:host)
  endif
  return v:null
endfunction

function! s:OpenUrl(row) abort
  let l:values = a:row.config.values
  if get(l:values, 'server.echo_url', v:false) is v:true
    call call(a:row.effects.notify, [a:row.url])
    return
  endif
  let l:function = get(l:values, 'browser.open_function', v:null)
  if type(l:function) == v:t_string && l:function !=# ''
    call call(a:row.effects.call_function, [l:function, a:row.url])
    return
  endif
  let l:browser = get(l:values, 'browser.name', v:null)
  if type(l:browser) == v:t_string && l:browser !=# ''
    call call(a:row.effects.open_named, [l:browser, a:row.url])
    return
  endif
  call call(a:row.effects.open, [a:row.url])
endfunction

function! s:OnMessage(row, message) abort
  if !call(a:row.alive, [])
    return
  endif
  if a:message._tag ==# 'ready'
    if a:row.state !=# 'starting'
      return
    endif
    call call(a:row.clear_timer, [])
    let a:row.state = 'open'
    let a:row.url = a:message.url
    call s:OpenUrl(a:row)
    return
  endif
  if a:message._tag ==# 'error'
    call call(a:row.on_error, [
          \ a:message.message,
          \ has_key(a:message, 'clientVersion') || has_key(a:message, 'serverVersion')])
  endif
endfunction

function! s:OnExit(row, job, code) abort
  let a:row.exited = 1
  let l:key = string(a:job)
  if has_key(a:row.expected_exit, l:key)
    call remove(a:row.expected_exit, l:key)
    return
  endif
  if !call(a:row.alive, [])
    return
  endif
  if a:row.fatal
    call call(a:row.teardown, [v:null])
    return
  endif
  call call(a:row.report, [
        \ markdown_viewer#messages#dead_server(a:row.log, a:code)])
  call call(a:row.teardown, [v:null])
endfunction

function! s:ClearTimer(row) abort
  if type(a:row.timer) == v:t_number && a:row.timer > 0
    call call(a:row.effects.timer_stop, [a:row.timer])
  endif
  let a:row.timer = -1
endfunction

function! s:Report(row, text) abort
  if a:row.last_reported isnot v:null && a:row.last_reported ==# a:text
    return
  endif
  let a:row.last_reported = a:text
  call call(a:row.effects.notify, [a:text])
endfunction

function! s:OnError(row, detail, fatal) abort
  if !call(a:row.alive, [])
    return
  endif
  if a:row.last_reported isnot v:null && a:row.last_reported ==# a:detail
    return
  endif
  let a:row.last_reported = a:detail
  let a:row.fatal = a:fatal
  call call(a:row.effects.notify, [a:detail])
  if a:row.state ==# 'starting'
    call call(a:row.teardown, [v:null])
  endif
endfunction

function! s:OnErrorFrame(row, failure) abort
  let l:detail = type(a:failure) == v:t_dict
        \ ? get(a:failure, 'detail', 'Markdown Viewer: unreadable frame.')
        \ : 'Markdown Viewer: unreadable frame.'
  call call(a:row.on_error, [l:detail, 0])
endfunction

function! s:Teardown(session, row, reason) abort
  if !has_key(a:session.rows, string(a:row.bufnr))
        \ || a:session.rows[string(a:row.bufnr)] isnot a:row
    return
  endif

  call remove(a:session.rows, string(a:row.bufnr))
  if a:row.refresh isnot v:null
    call call(a:row.refresh.stop, [])
  endif
  call call(a:row.clear_timer, [])
  call call(a:row.effects.clear_group, [
        \ 'markdown_viewer_row_' . a:row.bufnr])

  if a:row.job isnot v:null && !a:row.exited
    let a:session.expected_exit[string(a:row.job)] = 1
    call call(a:row.effects.close_stdin, [a:row.job])
    call call(a:row.effects.defer, [
          \ {-> call(a:row.effects.job_stop, [a:row.job])},
          \ s:EXIT_GRACE_MS])
  endif

  if a:reason isnot v:null
    call call(a:row.report, [a:reason])
  endif
endfunction

function! s:OnTimeout(session, row) abort
  if has_key(a:session.rows, string(a:row.bufnr))
        \ && a:session.rows[string(a:row.bufnr)] is a:row
        \ && a:row.state ==# 'starting'
    call call(a:row.teardown, [
          \ markdown_viewer#messages#timeout(s:START_TIMEOUT_MS, a:row.log)])
  endif
endfunction

function! s:SendRefresh(row, path, text) abort
  if !call(a:row.alive, []) || a:row.state !=# 'open'
    return 0
  endif
  return s:Transmit(a:row, {'path': a:path, 'text': a:text})
endfunction

function! s:AutoClose(row) abort
  if !call(a:row.alive, [])
    return
  endif
  let l:normalized = call(a:row.effects.normalize, [])
  let l:setting = get(l:normalized.values, 'preview.auto_close', v:true)
  if l:setting isnot v:false
    call call(a:row.teardown, [v:null])
  endif
endfunction

function! s:Start(session, bufnr) abort
  let l:effects = a:session.effects
  let l:bufnr = a:bufnr is v:null ? call(l:effects.current_buf, []) : a:bufnr
  if has_key(a:session.rows, string(l:bufnr))
    return
  endif
  let l:read = s:ReadBuffer(l:effects, l:bufnr)
  if l:read is v:null
    return
  endif

  let l:state = a:session
  let l:refused = s:EndpointRefusal(call(l:effects.normalize, []))
  if l:refused isnot v:null
    call call(l:effects.notify, [l:refused])
    return
  endif
  let l:normalized = call(l:effects.normalize, [])
  let l:configuredPort = get(l:normalized.values, 'server.port', v:null)
  let l:port = l:configuredPort
  if type(l:configuredPort) == v:t_number
    for l:other in values(a:session.rows)
      if l:other.requestedPort == l:configuredPort
        let l:port = 0
      endif
    endfor
  endif
  let l:row = {
        \ 'bufnr': l:bufnr,
        \ 'effects': l:effects,
        \ 'state': 'starting',
        \ 'job': v:null,
        \ 'url': v:null,
        \ 'log': v:null,
        \ 'last_reported': v:null,
        \ 'reported': {},
        \ 'timer': -1,
        \ 'exited': 0,
        \ 'fatal': 0,
        \ 'refresh': v:null,
        \ 'config': l:normalized,
        \ 'requestedPort': l:port,
        \ 'expected_exit': a:session.expected_exit,
        \ 'rows': a:session.rows,
        \ 'session': a:session,
        \ }
  let l:row.alive = {-> has_key(l:state.rows, string(l:row.bufnr))
        \ && l:state.rows[string(l:row.bufnr)] is l:row}
  let l:row.report = {text -> s:Report(l:row, text)}
  let l:row.clear_timer = {-> s:ClearTimer(l:row)}
  let l:row.on_error = {detail, fatal -> s:OnError(l:row, detail, fatal)}
  let l:row.teardown = {reason -> s:Teardown(l:state, l:row, reason)}

  let l:frame = s:EncodeDocument(l:row, l:read.path, l:read.text)
  if l:frame is v:null
    return
  endif

  let l:found = call(l:effects.discovery, [{}])
  if !l:found.ok
    call call(l:effects.notify, [l:found.message])
    return
  endif

  let l:row.log = call(l:effects.log_path, [])
  let l:cmd = [l:found.command] + l:found.args
        \ + ['editor', '--log-file', l:row.log]
  let l:host = get(l:normalized.values, 'server.open_ip', '')
  if type(l:host) == v:t_string && l:host !=# ''
    let l:cmd += ['--host', l:host]
  endif
  if type(l:port) == v:t_number
    let l:cmd += ['--port', string(l:port)]
  endif
  let a:session.rows[string(l:bufnr)] = l:row

  try
    let l:job = call(l:effects.job_start, [l:cmd, {
          \ 'in_io': 'pipe',
          \ 'out_io': 'pipe',
          \ 'out_mode': 'nl',
          \ 'out_cb': markdown_viewer#frames#handler(
          \   {message -> s:OnMessage(l:row, message)},
          \   {failure -> s:OnErrorFrame(l:row, failure)}),
          \ 'exit_cb': {job, code -> s:OnExit(l:row, job, code)},
          \ }])
  catch
    call remove(a:session.rows, string(l:bufnr))
    call call(l:effects.notify, [
          \ markdown_viewer#messages#start_failed(l:row.log)])
    return
  endtry

  if (type(l:job) != v:t_job && type(l:job) != v:t_number)
        \ || (type(l:job) == v:t_job && job_status(l:job) ==# 'fail')
    call remove(a:session.rows, string(l:bufnr))
    call call(l:effects.notify, [
          \ markdown_viewer#messages#start_failed(l:row.log)])
    return
  endif
  let l:row.job = l:job

  if !s:SendConfiguration(l:row)
        \ || !call(l:effects.send, [l:job, l:frame])
    call call(l:row.teardown, [
          \ markdown_viewer#messages#start_failed(l:row.log)])
    return
  endif

  let l:row.refresh = s:MakeRefresh(l:row)
  call s:InstallRow(l:row)

  let l:row.timer = call(l:effects.timer_start, [
        \ s:START_TIMEOUT_MS,
        \ {-> s:OnTimeout(l:state, l:row)}])
endfunction

function! s:MakeRefresh(row) abort
  let l:effects = a:row.effects
  let l:row = a:row
  return markdown_viewer#refresh#new({
        \ 'group': 'markdown_viewer_refresh_' . l:row.bufnr,
        \ 'read': {subject -> s:ReadBuffer(l:effects, subject is v:null ? l:row.bufnr : subject)},
        \ 'send': {path, text -> s:SendRefresh(l:row, path, text)},
        \ 'before_send': {-> s:SyncConfiguration(l:row)},
        \ 'send_cursor': {-> s:SendCursor(l:row)},
        \ 'now': l:effects.now,
        \ 'timer': {
        \   'schedule': l:effects.timer_start,
        \   'cancel': l:effects.timer_stop,
        \ },
        \ })
endfunction

function! s:IsCombine(row) abort
  return a:row.config isnot v:null
        \ && get(a:row.config.values, 'preview.combine', v:false) is v:true
endfunction

function! s:OtherMember(session, exclude) abort
  let l:loaded = has_key(a:session.effects, 'loaded_bufs')
        \ ? call(a:session.effects.loaded_bufs, [])
        \ : map(getbufinfo({'bufloaded': 1}), 'v:val.bufnr')
  for l:bufnr in l:loaded
    if l:bufnr != a:exclude && s:ReadBuffer(a:session.effects, l:bufnr) isnot v:null
      return l:bufnr
    endif
  endfor
  return v:null
endfunction

function! s:InstallRow(row) abort
  let l:group = call(a:row.effects.create_group, [
        \ 'markdown_viewer_row_' . a:row.bufnr])
  let l:Close = {-> s:CloseRow(a:row)}
  for l:event in ['BufDelete', 'BufWipeout', 'BufHidden']
    call call(a:row.effects.create_autocmd, [l:event, {
          \ 'group': l:group,
          \ 'bufnr': a:row.bufnr,
          \ 'callback': l:Close,
          \ }])
  endfor
endfunction

function! s:RebindRow(row, bufnr) abort
  let l:read = s:ReadBuffer(a:row.effects, a:bufnr)
  if l:read is v:null
    return 0
  endif
  call remove(a:row.rows, string(a:row.bufnr))
  let a:row.bufnr = a:bufnr
  let a:row.rows[string(a:bufnr)] = a:row
  let a:row.refresh = s:MakeRefresh(a:row)
  call s:InstallRow(a:row)
  if s:IsCombine(a:row)
        \ && get(a:row.config.values, 'preview.combine_auto_refresh', v:true) isnot v:false
    call s:Transmit(a:row, l:read)
  endif
  if a:row.refresh isnot v:null
    call call(a:row.refresh.rebind, [])
  endif
  return 1
endfunction

function! s:CloseRow(row) abort
  if !has_key(a:row.session.rows, string(a:row.bufnr))
        \ || a:row.session.rows[string(a:row.bufnr)] isnot a:row
    return
  endif
  if s:IsCombine(a:row)
    let l:other = s:OtherMember(a:row.session, a:row.bufnr)
    if l:other isnot v:null
      call s:RebindRow(a:row, l:other)
      return
    endif
  endif
  call call(a:row.teardown, [v:null])
endfunction

function! s:CombineRow(session) abort
  for l:row in values(a:session.rows)
    if s:IsCombine(l:row)
      return l:row
    endif
  endfor
  return v:null
endfunction

function! s:Enter(session, bufnr) abort
  if has_key(a:session.rows, string(a:bufnr))
    return
  endif
  let l:row = s:CombineRow(a:session)
  if l:row isnot v:null
    call s:RebindRow(l:row, a:bufnr)
  endif
endfunction

function! s:AutoStart(session, bufnr) abort
  let l:normalized = call(a:session.effects.normalize, [])
  let l:setting = get(l:normalized.values, 'preview.auto_start', v:false)
  if l:setting is v:false
    return
  endif
  if has_key(a:session.rows, string(a:bufnr))
    return
  endif
  if s:ReadBuffer(a:session.effects, a:bufnr) is v:null
    return
  endif
  call s:Start(a:session, a:bufnr)
endfunction

function! s:CursorAt(session, bufnr) abort
  let l:row = get(a:session.rows, string(a:bufnr), v:null)
  if l:row is v:null
    return 0
  endif
  return s:SendCursor(l:row)
endfunction

function! s:On(session, kind, bufnr) abort
  let l:row = get(a:session.rows, string(a:bufnr), v:null)
  if l:row isnot v:null && l:row.refresh isnot v:null
    call call(l:row.refresh.on, [a:kind, a:bufnr])
  endif
endfunction

function! s:Rebind(session, bufnr) abort
  let l:row = get(a:session.rows, string(a:bufnr), v:null)
  if l:row isnot v:null && l:row.refresh isnot v:null
    call call(l:row.refresh.rebind, [])
  endif
endfunction

function! s:Preview(session, bufnr) abort
  let l:row = get(a:session.rows, string(a:bufnr), v:null)
  if l:row isnot v:null
    if l:row.state ==# 'starting'
      return
    endif
    call call(l:row.refresh.manual, [])
    return
  endif
  let l:combine = s:CombineRow(a:session)
  if l:combine isnot v:null
    call s:RebindRow(l:combine, a:bufnr)
    return
  endif
  call s:Start(a:session, a:bufnr)
endfunction

function! s:Stop(session, bufnr) abort
  let l:bufnr = a:bufnr is v:null ? call(a:session.effects.current_buf, []) : a:bufnr
  let l:row = get(a:session.rows, string(l:bufnr), v:null)
  if l:row isnot v:null
    call call(l:row.teardown, [v:null])
  endif
endfunction

function! s:Toggle(session, bufnr) abort
  let l:bufnr = a:bufnr is v:null ? call(a:session.effects.current_buf, []) : a:bufnr
  let l:row = get(a:session.rows, string(l:bufnr), v:null)
  if l:row is v:null
    call s:Preview(a:session, l:bufnr)
  else
    call call(l:row.teardown, [v:null])
  endif
endfunction

" The test seam: the production effects, before one is replaced in a driver.
function! markdown_viewer#session#default_effects() abort
  return s:DefaultEffects()
endfunction

function! markdown_viewer#session#new(effects) abort
  let l:session = {
        \ 'effects': a:effects,
        \ 'rows': {},
        \ 'expected_exit': {},
        \ }
  let l:handle = {
        \ 'state': l:session,
        \ 'preview': {bufnr -> s:Preview(l:session, bufnr)},
        \ 'stop': {bufnr -> s:Stop(l:session, bufnr)},
        \ 'toggle': {bufnr -> s:Toggle(l:session, bufnr)},
        \ 'auto_start': {bufnr -> s:AutoStart(l:session, bufnr)},
        \ 'cursor': {bufnr -> s:CursorAt(l:session, bufnr)},
        \ 'on': {kind, bufnr -> s:On(l:session, kind, bufnr)},
        \ 'enter': {bufnr -> s:Enter(l:session, bufnr)},
        \ 'rebind': {bufnr -> s:Rebind(l:session, bufnr)},
        \ 'config_changed': {-> s:SyncAll(l:session)},
        \ 'stop_all': {-> s:StopAll(l:session)},
        \ 'rows': {-> s:Rows(l:session)},
        \ }
  return l:handle
endfunction

function! s:SyncAll(session) abort
  for l:row in values(a:session.rows)
    call s:SyncConfiguration(l:row)
  endfor
endfunction

function! s:StopAll(session) abort
  for l:row in values(a:session.rows)
    call call(l:row.teardown, [v:null])
  endfor
endfunction

function! s:Rows(session) abort
  let l:snapshot = {}
  for l:key in keys(a:session.rows)
    let l:row = a:session.rows[l:key]
    let l:snapshot[str2nr(l:key)] = {
          \ 'state': l:row.state,
          \ 'job': l:row.job,
          \ 'url': l:row.url,
          \ }
  endfor
  return l:snapshot
endfunction

function! s:EnterDefault() abort
  if s:default isnot v:null
    call s:Enter(s:default.state, str2nr(expand('<abuf>')))
  endif
endfunction

function! s:StopDefault() abort
  if s:default isnot v:null
    call s:StopAll(s:default.state)
  endif
endfunction

function! s:Handle() abort
  if s:default is v:null
    let s:default = markdown_viewer#session#new(s:DefaultEffects())
    augroup markdown_viewer_rows
      autocmd!
      autocmd VimLeavePre * call <SID>StopDefault()
      autocmd BufEnter * call <SID>EnterDefault()
    augroup END
  endif
  return s:default
endfunction

function! markdown_viewer#session#preview(...) abort
  call s:Preview(s:Handle().state, a:0 ? a:1 : v:null)
endfunction

function! markdown_viewer#session#stop(...) abort
  call s:Stop(s:Handle().state, a:0 ? a:1 : v:null)
endfunction

function! markdown_viewer#session#toggle(...) abort
  call s:Toggle(s:Handle().state, a:0 ? a:1 : v:null)
endfunction

function! markdown_viewer#session#auto_start(bufnr) abort
  call s:AutoStart(s:Handle().state, a:bufnr)
endfunction

function! markdown_viewer#session#cursor(bufnr) abort
  call s:CursorAt(s:Handle().state, a:bufnr)
endfunction

function! markdown_viewer#session#on(kind, bufnr) abort
  call s:On(s:Handle().state, a:kind, a:bufnr)
endfunction

function! markdown_viewer#session#enter(bufnr) abort
  call s:Enter(s:Handle().state, a:bufnr)
endfunction

function! markdown_viewer#session#rebind(bufnr) abort
  call s:Rebind(s:Handle().state, a:bufnr)
endfunction

function! markdown_viewer#session#config_changed() abort
  if s:default isnot v:null
    call s:SyncAll(s:default.state)
  endif
endfunction

function! markdown_viewer#session#rows() abort
  if s:default is v:null
    return {}
  endif
  return s:Rows(s:default.state)
endfunction

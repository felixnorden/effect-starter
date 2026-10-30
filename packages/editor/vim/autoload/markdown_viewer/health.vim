" The health report: the same eight fields, order and fix rule as Neovim.
" Vim has no health runtime at 8.2 or 9.2, so :MarkdownViewerHealth prints it.

let s:fields = [
      \ 'discovery',
      \ 'server',
      \ 'package',
      \ 'bun',
      \ 'wire',
      \ 'opener',
      \ 'ports',
      \ 'floor',
      \ ]

function! s:SplitLines(text) abort
  let l:lines = {}
  for l:line in split(a:text, "\n")
    let l:parts = matchlist(l:line, '^\(\S\+\)\s\+\(.\+\)$')
    if !empty(l:parts)
      let l:lines[l:parts[1]] = l:parts[2]
    endif
  endfor
  return l:lines
endfunction

function! s:ServerVersion(found) abort
  if !a:found.ok
    return v:null
  endif
  let l:cmd = [a:found.command] + a:found.args + ['version']
  return s:SplitLines(system(l:cmd))
endfunction

function! s:Opener(values) abort
  if get(a:values, 'server.echo_url', v:false) is v:true
    return 'echo'
  endif
  let l:name = get(a:values, 'browser.open_function', v:null)
  if type(l:name) == v:t_string && l:name !=# ''
    return 'function:' . l:name
  endif
  let l:browser = get(a:values, 'browser.name', v:null)
  if type(l:browser) == v:t_string && l:browser !=# ''
    return 'named:' . l:browser
  endif
  return 'default'
endfunction

function! s:Ports(rows) abort
  let l:open = []
  for l:row in values(a:rows)
    let l:url = get(l:row, 'url', v:null)
    if type(l:url) == v:t_string
      let l:port = matchstr(l:url, ':\zs\d\+')
      if l:port !=# ''
        let l:open += [l:port]
      endif
    endif
  endfor
  if empty(l:open)
    return 'none'
  endif
  return join(sort(l:open, 'n'), ',')
endfunction

function! s:Version() abort
  return printf('%d.%d', v:version / 100, v:version % 100)
endfunction

function! s:Floor() abort
  if has('patch-8.2.1978')
    return ['ok (vim ' . s:Version() . ' >= 8.2.1978)', v:null]
  endif
  return [v:null, 'vim ' . s:Version() . ' is older than 8.2.1978']
endfunction

" The ordered report, as dictionaries with key, value and optional fix.
function! markdown_viewer#health#report(...) abort
  let l:deps = a:0 > 0 ? a:1 : {}
  let l:found = has_key(l:deps, 'discovery')
        \ ? l:deps.discovery : markdown_viewer#discovery#find({})
  let l:values = has_key(l:deps, 'values')
        \ ? l:deps.values : markdown_viewer#init#get().values
  let l:version = has_key(l:deps, 'version')
        \ ? l:deps.version : s:ServerVersion(l:found)

  let l:rows = []
  let l:missing = 'install a compiled server or set g:markdown_viewer_server'
  call add(l:rows, {'key': 'discovery', 'value': l:found.ok ? 'ok' : 'missing',
        \ 'fix': l:found.ok ? v:null : get(l:found, 'message', l:missing)})
  call add(l:rows, {'key': 'server',
        \ 'value': l:found.ok ? join([l:found.command] + l:found.args, ' ') : 'missing',
        \ 'fix': l:found.ok ? v:null : l:missing})

  for l:key in ['package', 'bun', 'wire']
    let l:value = type(l:version) == v:t_dict ? get(l:version, l:key, v:null) : v:null
    call add(l:rows, {'key': l:key, 'value': l:value is v:null ? 'unknown' : l:value,
          \ 'fix': l:value is v:null
          \ ? 'run `mdv version` from a repository checkout with bun installed' : v:null})
  endfor

  call add(l:rows, {'key': 'opener', 'value': s:Opener(l:values), 'fix': v:null})
  let l:open_rows = has_key(l:deps, 'rows')
        \ ? l:deps.rows : markdown_viewer#session#rows()
  call add(l:rows, {'key': 'ports', 'value': s:Ports(l:open_rows), 'fix': v:null})

  let l:floor = has_key(l:deps, 'floor') ? l:deps.floor : s:Floor()
  call add(l:rows, {'key': 'floor', 'value': l:floor[0] is v:null ? l:floor[1] : l:floor[0],
        \ 'fix': l:floor[0] is v:null ? 'upgrade Vim to 8.2.1978 or newer' : v:null})
  return l:rows
endfunction

function! markdown_viewer#health#print() abort
  for l:entry in markdown_viewer#health#report()
    echomsg l:entry.key . ': ' . l:entry.value
    if l:entry.fix isnot v:null
      echomsg 'fix: ' . l:entry.fix
    endif
  endfor
endfunction

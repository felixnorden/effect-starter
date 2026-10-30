" One generic interpreter of the generated key table. No key name appears here.

function! s:Keys() abort
  return markdown_viewer#generated#config#get().keys
endfunction

function! s:IsNull(value) abort
  return type(a:value) == v:t_none
endfunction

function! s:Dig(root, dotted) abort
  let l:node = a:root
  for l:part in split(a:dotted, '\.')
    if type(l:node) != v:t_dict
      return v:null
    endif
    if !has_key(l:node, l:part)
      return v:null
    endif
    let l:node = l:node[l:part]
  endfor
  return l:node
endfunction

function! s:Serialize(value) abort
  if type(a:value) == v:t_list
    return '[' . join(map(copy(a:value), {_, item -> s:Serialize(item)}), ',') . ']'
  elseif type(a:value) == v:t_dict
    let l:parts = []
    for l:key in sort(keys(a:value))
      call add(l:parts, '"' . l:key . '":' . s:Serialize(a:value[l:key]))
    endfor
    return '{' . join(l:parts, ',') . '}'
  elseif type(a:value) == v:t_string
    return '"' . escape(a:value, '\\"') . '"'
  elseif type(a:value) == v:t_bool
    return a:value ? 'true' : 'false'
  elseif type(a:value) == v:t_number
    return string(a:value)
  endif
  return 'null'
endfunction

function! s:Received(value) abort
  if s:IsNull(a:value)
    return 'nil'
  elseif type(a:value) == v:t_string
    return a:value
  elseif type(a:value) == v:t_bool
    return a:value ? 'true' : 'false'
  elseif type(a:value) == v:t_number
    return string(a:value)
  elseif type(a:value) == v:t_list || type(a:value) == v:t_dict
    return s:Serialize(a:value)
  endif
  return string(a:value)
endfunction

function! s:Expected(key) abort
  if len(a:key.values) > 0
    return join(a:key.values, '|')
  endif
  return a:key.type
endfunction

function! s:Validate(key, value) abort
  if len(a:key.values) > 0
    if index(a:key.values, a:value) >= 0
      return v:null
    endif
    return {'expected': s:Expected(a:key), 'received': s:Received(a:value)}
  endif

  let l:ok = 0
  if a:key.type ==# 'string'
    let l:ok = type(a:value) == v:t_string
  elseif a:key.type ==# 'number'
    let l:ok = type(a:value) == v:t_number
  elseif a:key.type ==# 'boolean'
    let l:ok = type(a:value) == v:t_bool
  elseif a:key.type ==# 'string-list'
    if type(a:value) == v:t_list
      let l:ok = 1
      for l:item in a:value
        if type(l:item) != v:t_string
          let l:ok = 0
          break
        endif
      endfor
    endif
  elseif a:key.type ==# 'json'
    let l:ok = type(a:value) == v:t_dict || type(a:value) == v:t_func
  endif

  if l:ok
    return v:null
  endif
  return {'expected': s:Expected(a:key), 'received': s:Received(a:value)}
endfunction

function! s:Report(deps, id, text) abort
  if has_key(a:deps.warned, a:id)
    return
  endif
  let a:deps.warned[a:id] = 1
  call call(a:deps.notify, [a:text])
endfunction

function! s:Variable(vim_name) abort
  return a:vim_name[2:]
endfunction

function! s:Baseline(key, deps) abort
  if s:IsNull(a:key.alias)
    return [v:null, v:null]
  endif

  if a:key.alias_scope ==# 'global'
    let l:name = 'mkdp_' . a:key.alias
    return [call(a:deps.g, [l:name]), 'g:' . l:name]
  endif

  let l:nested = call(a:deps.g, ['mkdp_preview_options'])
  if type(l:nested) != v:t_dict
    return [v:null, v:null]
  endif
  if !has_key(l:nested, a:key.alias)
    return [v:null, v:null]
  endif
  return [l:nested[a:key.alias], 'g:mkdp_preview_options.' . a:key.alias]
endfunction

function! s:Normalize(settings, deps) abort
  let l:values = {}
  let l:sources = {}

  for l:key in s:Keys()
    if l:key.container
      continue
    endif

    let l:value = s:Dig(a:settings, l:key.name)
    let l:source = v:null
    if !s:IsNull(l:value)
      let l:source = 'setup:' . l:key.name
    else
      let l:value = call(a:deps.g, [s:Variable(l:key.vim_name)])
      if !s:IsNull(l:value)
        let l:source = l:key.vim_name
      else
        let [l:value, l:source] = s:Baseline(l:key, a:deps)
      endif
    endif

    if !s:IsNull(l:value)
      if l:key.type ==# 'boolean' && type(l:value) == v:t_number && (l:value == 0 || l:value == 1)
        let l:value = l:value == 1 ? v:true : v:false
      endif
      let l:failure = s:Validate(l:key, l:value)
      if s:IsNull(l:failure)
        if l:key.inverted
          let l:value = l:value ? v:false : v:true
        endif
        if l:source !=# l:key.vim_name && l:source !=# ('setup:' . l:key.name)
          call s:Report(
                \ a:deps,
                \ 'alias:' . l:source,
                \ printf('Markdown Viewer: %s is deprecated; use %s.', l:source, l:key.vim_name))
        endif
      else
        call s:Report(
              \ a:deps,
              \ 'invalid:' . l:key.name . ':' . l:source . ':' . l:failure.received,
              \ printf(
              \   markdown_viewer#generated#config#get().error_format,
              \   l:key.name,
              \   l:failure.expected,
              \   l:failure.received,
              \   l:source))
        let l:value = v:null
        let l:source = v:null
      endif
    endif

    if s:IsNull(l:value)
      let l:value = l:key.default
      let l:source = 'default'
    endif
    if !s:IsNull(l:value)
      let l:values[l:key.name] = l:value
    endif
    let l:sources[l:key.name] = l:source
  endfor

  let l:nested = call(a:deps.g, ['mkdp_preview_options'])
  if type(l:nested) == v:t_dict
    let l:known = {}
    for l:key in s:Keys()
      if !s:IsNull(l:key.alias) && l:key.alias_scope ==# 'preview_options'
        let l:known[l:key.alias] = 1
      endif
    endfor
    for l:name in keys(l:nested)
      if !has_key(l:known, l:name)
        call s:Report(
              \ a:deps,
              \ 'unknown:' . l:name,
              \ printf(
              \   'Markdown Viewer: unknown g:mkdp_preview_options key "%s"; ignored.',
              \   l:name))
      endif
    endfor
  endif

  return {'values': l:values, 'sources': l:sources}
endfunction

function! s:Noop(text) abort
endfunction

function! s:ReadG(name) abort
  return get(g:, a:name, v:null)
endfunction

function! markdown_viewer#config#normalize(settings, ...) abort
  let l:deps = a:0 >= 1 && a:1 isnot v:null
        \ ? a:1
        \ : {'notify': function('s:Noop'), 'warned': {}, 'g': function('s:ReadG')}
  return s:Normalize(s:IsNull(a:settings) ? {} : a:settings, l:deps)
endfunction

function! markdown_viewer#config#split(normalized) abort
  let l:groups = {
        \ 'editor': {},
        \ 'endpoint': {},
        \ 'render': {},
        \ 'display': {},
        \ 'process': {},
        \ 'frame': [],
        \ }

  for l:key in s:Keys()
    if l:key.container
      continue
    endif
    let l:value = get(a:normalized.values, l:key.name, v:null)
    let l:source = get(a:normalized.sources, l:key.name, 'default')
    let l:name = l:key.class ==# 'page-display' ? 'display' : l:key.class
    if has_key(l:groups, l:name)
      let l:groups[l:name][l:key.name] = l:value
    endif
    if (l:key.class ==# 'render' || l:key.class ==# 'page-display')
          \ && l:source !=# 'default'
          \ && !s:IsNull(l:value)
      call add(l:groups.frame, {'key': l:key.name, 'value': l:value, 'source': l:source})
    endif
  endfor

  return l:groups
endfunction

function! markdown_viewer#config#hash(normalized) abort
  let l:parts = []
  for l:entry in markdown_viewer#config#split(a:normalized).frame
    call add(l:parts, l:entry.key . '=' . s:Serialize(l:entry.value) . '|' . l:entry.source)
  endfor
  return sha256(join(l:parts, "\n"))
endfunction

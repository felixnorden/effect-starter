" The recorded Vim conformance run: decode every committed golden frame with
" the real generated codec, then run the shared discovery cases.
" Run with: vim -u NONE -N -es -S editor/vim/tests/conformance.vim < /dev/null
let s:root = expand('<sfile>:p:h:h:h:h')
let &runtimepath = s:root . '/editor/vim,' . &runtimepath
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

let s:cases_text = s:ReadFile(s:root . '/editor/tests/discovery-cases.json')
if s:cases_text is v:null
  call s:Fail('missing editor/tests/discovery-cases.json')
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

call s:Out(
      \ printf(
      \   'OK vim conformance (%d frames, %d discovery cases)',
      \   len(s:manifest.cases),
      \   len(s:discovered)))
qall!

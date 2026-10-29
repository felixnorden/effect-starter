" One lookup order and one failure message, mirrored from the Neovim module.
" Candidate 3 is `bun` plus the repository entry, resolved through the real path
" of the plugin directory.

" Captured at script load: <sfile> inside a function names the sourcing script.
let s:PluginDir = fnamemodify(expand('<sfile>:p'), ':h:h:h')

function! s:OsToken() abort
  if has('win32') || has('win64')
    return 'win32'
  endif
  if has('macunix')
    return 'darwin'
  endif
  return 'linux'
endfunction

function! s:ArchToken() abort
  if has('win64')
    return $PROCESSOR_ARCHITECTURE ==? 'ARM64' ? 'arm64' : 'x64'
  endif
  let l:machine = substitute(system('uname -m'), '\n', '', 'g')
  if l:machine ==# 'x86_64' || l:machine ==# 'amd64'
    return 'x64'
  endif
  if l:machine ==# 'arm64' || l:machine ==# 'aarch64'
    return 'arm64'
  endif
  return l:machine
endfunction

function! s:DefaultPluginDir() abort
  return s:PluginDir
endfunction

function! s:DefaultExists(path) abort
  return executable(a:path) || filereadable(a:path)
endfunction

function! s:DefaultRealpath(path) abort
  return resolve(a:path)
endfunction

" Returns { 'ok': 1, 'command': ..., 'args': [...] } or { 'ok': 0, 'message': ... }.
function! markdown_viewer#discovery#find(options) abort
  let l:Exists = get(a:options, 'exists', v:null)
  if l:Exists is v:null
    let l:Exists = function('s:DefaultExists')
  endif
  let l:Realpath = get(a:options, 'realpath', v:null)
  if l:Realpath is v:null
    let l:Realpath = function('s:DefaultRealpath')
  endif
  let l:os = get(a:options, 'os', s:OsToken())
  let l:arch = get(a:options, 'arch', s:ArchToken())
  let l:plugin_dir = l:Realpath(get(a:options, 'plugin_dir', s:DefaultPluginDir()))
  let l:attempts = []

  let l:configured = get(a:options, 'configured', get(g:, 'markdown_viewer_server', v:null))
  if l:configured isnot v:null && type(l:configured) == v:t_string && l:configured !=# ''
    if l:Exists(l:configured)
      return {'ok': 1, 'command': l:configured, 'args': []}
    endif
    call add(l:attempts, l:configured)
  endif

  let l:shared = simplify(l:plugin_dir . '/../bin')
  for l:base in [l:plugin_dir . '/bin', l:shared]
    let l:binary = l:base . '/mdv-' . l:os . '-' . l:arch
    let l:candidates = l:os ==# 'win32' ? [l:binary . '.exe', l:binary] : [l:binary]
    for l:candidate in l:candidates
      if l:Exists(l:candidate)
        return {'ok': 1, 'command': l:candidate, 'args': []}
      endif
      call add(l:attempts, l:candidate)
    endfor
  endfor

  let l:entry = simplify(l:plugin_dir . '/../../../packages/app/src/main.ts')
  if l:Exists('bun') && l:Exists(l:entry)
    return {'ok': 1, 'command': 'bun', 'args': [l:entry]}
  endif
  call add(l:attempts, 'bun ' . l:entry)

  return {
        \ 'ok': 0,
        \ 'message': printf(
        \   'Markdown Viewer: no server found. Tried %s. Run from a repository checkout with bun installed, or set g:markdown_viewer_server.',
        \   join(l:attempts, ', ')),
        \ }
endfunction

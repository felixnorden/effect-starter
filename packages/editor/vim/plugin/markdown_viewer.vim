" Commands and maps come from the configuration: buffer-local in a configured
" filetype, or global when `preview.command_for_global` is on. The baseline
" plugin in the same runtime path is a conflict, reported before any command
" exists. A later `preview.filetypes` change takes effect at the next FileType
" event; no loaded-buffer sweep runs, and the stale window is recorded (G-50).

if exists('g:loaded_markdown_viewer')
  finish
endif
let g:loaded_markdown_viewer = 1

let s:plugin_dir = fnamemodify(expand('<sfile>:p'), ':h:h')

function! s:BaselineDir() abort
  for l:dir in split(&runtimepath, ',')
    if filereadable(l:dir . '/plugin/mkdp.vim')
      return l:dir
    endif
  endfor
  return v:null
endfunction

let s:baseline = s:BaselineDir()
if s:baseline isnot v:null
  echohl ErrorMsg
  echomsg printf(
        \ 'Markdown Viewer: both plugins are on the runtime path: the baseline plugin at %s and this plugin at %s. Remove the baseline plugin.',
        \ s:baseline,
        \ s:plugin_dir)
  echohl None
  finish
endif

command! MarkdownViewerHealth call markdown_viewer#health#print()

function! s:Configured(filetype) abort
  let l:filetypes = get(markdown_viewer#init#get().values, 'preview.filetypes', ['markdown'])
  return index(l:filetypes, a:filetype) >= 0
endfunction

function! s:BufferCommands() abort
  command! -buffer MarkdownPreview call markdown_viewer#session#preview()
  command! -buffer MarkdownPreviewStop call markdown_viewer#session#stop()
  command! -buffer MarkdownPreviewToggle call markdown_viewer#session#toggle()

  nnoremap <buffer> <silent> <Plug>(MarkdownPreview) <Cmd>MarkdownPreview<CR>
  inoremap <buffer> <silent> <Plug>(MarkdownPreview) <Cmd>MarkdownPreview<CR>
  nnoremap <buffer> <silent> <Plug>(MarkdownPreviewStop) <Cmd>MarkdownPreviewStop<CR>
  inoremap <buffer> <silent> <Plug>(MarkdownPreviewStop) <Cmd>MarkdownPreviewStop<CR>
  nnoremap <buffer> <silent> <Plug>(MarkdownPreviewToggle) <Cmd>MarkdownPreviewToggle<CR>
  inoremap <buffer> <silent> <Plug>(MarkdownPreviewToggle) <Cmd>MarkdownPreviewToggle<CR>
endfunction

function! s:GlobalCommands() abort
  command! MarkdownPreview call markdown_viewer#session#preview()
  command! MarkdownPreviewStop call markdown_viewer#session#stop()
  command! MarkdownPreviewToggle call markdown_viewer#session#toggle()

  nnoremap <silent> <Plug>(MarkdownPreview) <Cmd>MarkdownPreview<CR>
  inoremap <silent> <Plug>(MarkdownPreview) <Cmd>MarkdownPreview<CR>
  nnoremap <silent> <Plug>(MarkdownPreviewStop) <Cmd>MarkdownPreviewStop<CR>
  inoremap <silent> <Plug>(MarkdownPreviewStop) <Cmd>MarkdownPreviewStop<CR>
  nnoremap <silent> <Plug>(MarkdownPreviewToggle) <Cmd>MarkdownPreviewToggle<CR>
  inoremap <silent> <Plug>(MarkdownPreviewToggle) <Cmd>MarkdownPreviewToggle<CR>
endfunction

augroup markdown_viewer_filetype
  autocmd!
  autocmd FileType * if s:Configured(expand('<amatch>')) | call s:BufferCommands() | call markdown_viewer#session#auto_start(str2nr(expand('<abuf>'))) | endif
augroup END

if get(markdown_viewer#init#get().values, 'preview.command_for_global', v:false) is v:true
  call s:GlobalCommands()
endif

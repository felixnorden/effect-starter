" The Vim entry point: no `setup()` table, so the settings are the `g:` variables.
" The reflect functions are the only state: they re-read the carriers on every
" call and keep the warn-once record for the session.

let s:warned = {}

function! markdown_viewer#init#notify(text) abort
  echohl WarningMsg
  echomsg a:text
  echohl None
endfunction

function! markdown_viewer#init#read_g(name) abort
  return get(g:, a:name, v:null)
endfunction

function! markdown_viewer#init#deps() abort
  return {
        \ 'notify': function('markdown_viewer#init#notify'),
        \ 'warned': s:warned,
        \ 'g': function('markdown_viewer#init#read_g'),
        \ }
endfunction

function! markdown_viewer#init#get() abort
  return markdown_viewer#config#normalize({}, markdown_viewer#init#deps())
endfunction

function! markdown_viewer#init#hash() abort
  return markdown_viewer#config#hash(markdown_viewer#init#get())
endfunction

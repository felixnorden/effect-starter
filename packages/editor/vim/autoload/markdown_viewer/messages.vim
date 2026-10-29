" The same five messages as the Neovim module, in the second language.

function! markdown_viewer#messages#unnamed() abort
  return 'Markdown Viewer: write the buffer to a file first, then run :MarkdownPreview.'
endfunction

function! markdown_viewer#messages#oversize(bytes) abort
  return printf('Markdown Viewer: the buffer exceeds the %d-byte frame cap; split the file and retry.', a:bytes)
endfunction

function! markdown_viewer#messages#start_failed(log) abort
  return printf('Markdown Viewer: the server did not start. Log: %s. Run :MarkdownPreview again.', a:log)
endfunction

function! markdown_viewer#messages#timeout(ms, log) abort
  return printf('Markdown Viewer: the server did not answer within %d ms. Log: %s.', a:ms, a:log)
endfunction

function! markdown_viewer#messages#dead_server(log, code) abort
  return printf('Markdown Viewer: the server exited (%s). Log: %s. Run :MarkdownPreview to start it again.', a:code, a:log)
endfunction

function! markdown_viewer#messages#floor() abort
  return 'Markdown Viewer: Vim 8.2.1978 or newer is required for <Cmd>. Upgrade Vim, or use <C-o>:MarkdownPreview<CR> in insert mode.'
endfunction

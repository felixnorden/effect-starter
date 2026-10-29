" Vim's `out_mode: 'nl'` calls the handler once per complete line, without the
" newline, so no join is needed here. The handler drops an empty line and hands
" the rest to the generated codec.

function! s:OnLine(on_message, on_error, channel, message) abort
  if a:message ==# ''
    return
  endif
  let [l:ok, l:value] = markdown_viewer#generated#codec#decode_frame(a:message)
  if l:ok
    call a:on_message(l:value)
  else
    call a:on_error(l:value)
  endif
endfunction

function! markdown_viewer#frames#handler(on_message, on_error) abort
  return function('s:OnLine', [a:on_message, a:on_error])
endfunction

function! markdown_viewer#frames#send(job, data) abort
  try
    call ch_sendraw(job_getchannel(a:job), a:data)
    return 1
  catch
    return 0
  endtry
endfunction

function! markdown_viewer#frames#close_stdin(job) abort
  try
    call ch_close_in(job_getchannel(a:job))
  catch
  endtry
endfunction

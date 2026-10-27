" No setup() table, no mkdp alias command, no <Plug> alias (settled decision 10).
" The commands carry the behaviour; the maps fire the commands through <Cmd>, so
" insert mode needs no mode change.

command! MarkdownPreview call markdown_viewer#session#preview()
command! MarkdownPreviewStop call markdown_viewer#session#stop()
command! MarkdownPreviewToggle call markdown_viewer#session#toggle()

nnoremap <silent> <Plug>(MarkdownPreview) <Cmd>MarkdownPreview<CR>
inoremap <silent> <Plug>(MarkdownPreview) <Cmd>MarkdownPreview<CR>
nnoremap <silent> <Plug>(MarkdownPreviewStop) <Cmd>MarkdownPreviewStop<CR>
inoremap <silent> <Plug>(MarkdownPreviewStop) <Cmd>MarkdownPreviewStop<CR>
nnoremap <silent> <Plug>(MarkdownPreviewToggle) <Cmd>MarkdownPreviewToggle<CR>
inoremap <silent> <Plug>(MarkdownPreviewToggle) <Cmd>MarkdownPreviewToggle<CR>

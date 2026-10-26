---
title: Kitchen Sink
author: Preview Fixture
---

# Kitchen Sink

A paragraph with **bold**, _italic_, ~~strikethrough~~, `inline code`, a
[relative link](notes.md), and a [reference link][notes].

A hard break ends this line.  
The next line follows it.

An autolink: <https://example.com> and a [hostile link](<javascript:alert(1)>).

## Lists

- first item
- second item
  - nested item
- [ ] todo item
- [x] done item

1. first ordered item
2. second ordered item
   1. nested ordered item

> A blockquote with **bold** text.
>
> > A nested blockquote.

## Table

| Name | Value |
| ---- | ----: |
| one  |     1 |
| two  |     2 |

## Code

```ts
const answer: number = 42;
console.log(answer);
```

```bash
echo "hello"
```

```json
{ "answer": 42 }
```

```notalang
plain text fallback
```

    indented code block
    second indented line

## Raw HTML

<div class="callout">
  <b>Bold</b> raw HTML with an <a href="javascript:alert(1)" onclick="alert(2)">link</a>.
  <script>alert("hostile")</script>
  <iframe src="https://example.com"></iframe>
</div>

Inline raw HTML: a <b onclick="alert(1)">bold</b> word and an inline
<script>alert("hostile")</script> script.

## Images

![Data URL](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)

![Local](images/pixel.png)

## Duplicate

## Duplicate

## Same-1

[notes]: notes.md

---

Final paragraph.

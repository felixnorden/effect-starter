---
title: Math Fidelity
---

A display formula sits between two paragraphs.

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

Inline math renders inside a sentence: $E = mc^2$ stays on one line.

A strong wrapper keeps its element: **a $x$ b**.

A link wrapper keeps its target: [see $x$](https://example.com).

| symbol      | formula |
| ----------- | ------- |
| inline math | $x + y$ |

A mixed paragraph keeps the authored span stripped while the math keeps its
classes: <span class="x" style="color:red">authored</span> and $x$.

An escaped dollar costs \$5, and a code span with `$x$` stays code.

Chemistry renders too: $\ce{H2O}$.

A malformed fraction renders the plugin's error span: $\frac{1}$.

An undefined control sequence renders as text: $\notacommand{}$.

# Grammar corpus

One fence per grammar key the highlighter ships.

```typescript
const value: string = "hi";
function greet() {
  return value + 42; // note
}
```

```tsx
export const App = () => <div className="box">hi</div>;
```

```javascript
const list = [1, 2];
console.log(list.length);
```

```jsx
const View = () => <span title="x">hi</span>;
```

```json
{ "a": 1, "b": true }
```

```bash
echo "hi" > out.txt
```

```markdown
# Title

A [link](https://example.com).
```

```yaml
name: build
steps:
  - run: echo hi
```

```html
<div class="box"><a href="#">hi</a></div>
```

```css
.box {
  color: red;
}
```

```python
def greet(name):
    return f"hi {name}"
```

```rust
fn main() {
    let value = 42;
}
```

```go
package main

func main() {
    value := 42
}
```

```sql
SELECT id FROM users WHERE active = true;
```

```diff
- old
+ new
```

```dockerfile
FROM alpine:3
RUN echo hi
```

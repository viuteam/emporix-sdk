---
"@viu/emporix-sdk": patch
---

`products.searchByName` no longer 400s on text a shopper actually types.

It escaped regex metacharacters, which is right for the regex but not enough for
the filter: Emporix parses the `q` DSL's own structure first, so an **escaped**
paren is still an unbalanced paren to it. `searchByName("Access (")` came back as

```
400 Missing closing parenthesis in value '(~Access \()' of key 'name'
```

Any search box wired to this crashed on an opening bracket.

`(`, `)` and `"` are now **removed** rather than escaped — measured against a live
tenant on 2026-08-03, those three are the only metacharacters that break this way;
every other one survives escaping and stays escaped.

Two details that follow from it:

- Removed brackets become a **space**, then runs of whitespace collapse. Dropping
  them outright would turn `Access(JIT)` into one run-together word, and leaving a
  double space behind would put two *literal* spaces in the regex — matching
  nothing.
- A query made only of those characters leaves nothing to search for and returns
  an **empty page without a request**, because `name:(~)` is itself a 400.

The escaping behaviour for every other character is unchanged, and one existing
test that asserted `name:(~a\.b\*\(c\))` was updated — it encoded the bug.

---
"@viu/emporix-sdk-react": patch
---

apply the provider's balanced query defaults (`staleTime: 30s`, no focus refetch, `retry: 1`) to the `["emporix"]` namespace of any QueryClient — including consumer-supplied ones, which previously ran SDK queries with React-Query factory defaults (focus-refetch storms + retry amplification against the live tenant). The provider only fills gaps: a consumer's explicit defaults win, whether set globally (`defaultOptions.queries`) or emporix-scoped (`setQueryDefaults(["emporix"], …)`), and per-hook options always win; host-app queries outside the namespace are untouched.

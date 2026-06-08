# Benchmark profiles

Per-instance characterization (file types + shell commands the agent uses), generated from
the `classic`-arm sessions. Maintained per §REQ-004-experiment-hygiene.4. Instances are
grouped by **command/file profile**, which defines which benches are *related* (§REQ-004.5):
a change to a sidekick behavior must be re-verified against the other instances in its group.

The build/test command is the key per-group signal — it's what the bash digest acts on; the
exploration commands (`sed`/`rg`/`grep`/`find`) are what the explore/graph lever replaces.

## Groups (language → build/test, graphify quality)

| group | build / test | graphify | instances |
|---|---|---|---|
| **C** | `make`, `g++` | weak | jq-2840, jq-2919, jq-3238, ponyc-4593, ponyc-4595, zstd-3438, zstd-3942 |
| **C++** | `g++` | weak | simdjson-2178 |
| **Go** | `go`, `gofmt` | strong | cli-10388, go-zero-2787, grpc-go-3119 |
| **Java** | `mvnw` (maven), `jshell` | strong | dubbo-11781, jackson-core-1309, logstash-17021, *fastjson2-2775*, *mockito-3424* |
| **JS** | `node`, npm | strong | axios-5919, svelte-15115, *insomnia-7734* |
| **TS** | `pnpm`, `node`, `npx` | strong | core-11899, darkreader-7241, *material-ui-39962* |
| **Rust** | `cargo` | strong | clap-5873, nushell-13870, serde-2798, tokio-7124, tracing-2897, *ripgrep-2626*, *bat-3189* |

*italic* = newly fetched, not yet run.

## Per-instance (top commands / fix-file type)

| lang | instance | bash calls | top commands | fix file type |
|---|---|---|---|---|
| C | jq-2919 | 14 | ls, sed, git, rg, make | .c |
| C | zstd-3438 | 31 | sed, grep, head, git | .c |
| C | ponyc-4593 | 14 | sed, rg, git, ponyc | .pony |
| C++ | simdjson-2178 | 45 | rg, sed, g++, git, python3 | .h/.cpp |
| Go | cli-10388 | 12 | sed, ls, rg, go | .go |
| Go | go-zero-2787 | 14 | sed, rg, git, gofmt | .go |
| Go | grpc-go-3119 | 14 | sed, find, ls, rg | .go |
| Java | dubbo-11781 | 25 | sed, rg, mvnw, find | .java |
| Java | jackson-core-1309 | 6 | sed, rg, mvnw, jshell | .java |
| Java | logstash-17021 | 21 | env, git, ls, find, sed | .java |
| JS | axios-5919 | 25 | grep, sed, node | .js/.cjs |
| JS | svelte-15115 | 27 | sed, rg, node | .js |
| Rust | clap-5873 | 11 | sed, rg, cargo | .rs |
| Rust | nushell-13870 | 25 | sed, rg, cargo, git | .rs |
| Rust | serde-2798 | 31 | sed, rg, cargo, cat | .rs |
| Rust | tokio-7124 | 18 | rg, sed, cargo | .rs/.toml |
| Rust | tracing-2897 | 12 | cat, rg, sed, cargo | .rs |
| TS | core-11899 | 16 | pnpm, ls, sed, node | .ts |
| TS | darkreader-7241 | 8 | sed, rg, cat, npx | .ts |

Regenerate after new runs:
`node` over `raw/*__classic/session/*.jsonl` (bash command verbs + read/edit/patch file extensions).

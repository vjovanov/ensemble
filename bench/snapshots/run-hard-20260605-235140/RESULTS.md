# run-hard snapshot — OLD-PROMPT baseline

Captured before the explore prompt changes (tokio/clap/nushell ran on the original
lead+sidekick prompts). Model: oca/gpt-5.5. Arms: ensamble-graphify (graph+PI_REQUIRE_GRAPH),
ensamble-fs-compact (sidekick, fs fallback), classic (rg/sed, no sidekick).

| instance | arm | total | input | output | cacheRead | $/run | turns | explore | bash | strict |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|:--:|
| tokio-rs | ensamble-graphify | 1845474 | 68117 | 13005 | 1764352 | $1.6129 | 55 | 5 | 29 | Y |
| tokio-rs | ensamble-fs-compact | 2764215 | 91520 | 12855 | 2659840 | $2.1732 | 55 | 13 | 22 | - |
| tokio-rs | classic | 1475209 | 61336 | 7921 | 1405952 | $1.2473 | 46 | 0 | 28 | - |
| clap-rs | ensamble-graphify | 309739 | 30438 | 2309 | 276992 | $0.36 | 16 | 4 | 9 | Y |
| clap-rs | ensamble-fs-compact | 211862 | 45970 | 2052 | 163840 | $0.3733 | 13 | 4 | 7 | - |
| clap-rs | classic | 240868 | 24369 | 2483 | 214016 | $0.3033 | 16 | 0 | 14 | - |
| nushell | ensamble-graphify | 587220 | 70431 | 1717 | 515072 | $0.6612 | 13 | 9 | 4 | Y |
| nushell | ensamble-fs-compact | 1866510 | 73548 | 6594 | 1786368 | $1.4587 | 38 | 10 | 20 | - |
| nushell | classic | 1054185 | 59597 | 8476 | 986112 | $1.0453 | 32 | 0 | 26 | - |

_Resolution: not graded for these hard instances (the earlier sweep showed go/rust/java unresolved across all arms). graphify segfaulted building the tokio graph (see raw/tokio*/graphify.log)._

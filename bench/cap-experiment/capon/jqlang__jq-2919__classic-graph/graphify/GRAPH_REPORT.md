# Graph Report - classic-graph  (2026-06-08)

## Corpus Check
- 110 files · ~344,821 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1244 nodes · 5086 edges · 56 communities (51 shown, 5 thin omitted)
- Extraction: 70% EXTRACTED · 30% INFERRED · 0% AMBIGUOUS · INFERRED: 1533 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7f547827`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 55|Community 55]]

## God Nodes (most connected - your core abstractions)
1. `jv_free()` - 160 edges
2. `jv_copy()` - 115 edges
3. `jv_get_kind()` - 112 edges
4. `jv` - 109 edges
5. `jv` - 80 edges
6. `block` - 78 edges
7. `decFloat` - 71 edges
8. `jv_string()` - 71 edges
9. `yyparse()` - 65 edges
10. `jq_state` - 61 edges

## Surprising Connections (you probably didn't know these)
- `LLVMFuzzerTestOneInput()` --calls--> `jv_free()`  [INFERRED]
  tests/jq_fuzz_load_file.c → src/jv.c
- `LLVMFuzzerTestOneInput()` --calls--> `jv_free()`  [INFERRED]
  tests/jq_fuzz_parse.c → src/jv.c
- `f_match()` --calls--> `jvp_utf8_decode_length()`  [INFERRED]
  src/builtin.c → src/jv_unicode.c
- `jq_init()` --calls--> `jv_mem_alloc_unguarded()`  [INFERRED]
  src/execute.c → src/jv_alloc.c
- `LLVMFuzzerTestOneInput()` --calls--> `jq_init()`  [INFERRED]
  tests/jq_fuzz_compile.c → src/execute.c

## Import Cycles
- None detected.

## Communities (56 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (177): regex_t, binop_divide(), binop_equal(), binop_greater(), binop_greatereq(), binop_less(), binop_lesseq(), binop_minus() (+169 more)

### Community 1 - "Community 1"
Cohesion: 0.21
Nodes (42): decCheckInexact(), decCheckMath(), decCheckNumber(), decCheckOperands(), decCompareOp(), decDecap(), decGetDigits(), decNaNs() (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (145): inst, bind_bytecoded_builtins(), builtins_bind(), block, gen_builtin_list(), opcode, opcode_describe(), bind_alternation_matchers() (+137 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (80): decCanonical(), decDivide(), decFiniteMultiply(), decFloatAbs(), decFloatAdd(), decFloatAnd(), decFloatCanonical(), decFloatClass() (+72 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (94): jq_input_cb, jq_msg_cb, jv_nomem_handler_f, bytecode_free(), bytecode_operation_length(), dump_code(), getlevel(), symbol_table_free() (+86 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (61): FILE, YYLTYPE, YYSTYPE, enter(), if(), input(), try_exit(), yy_create_buffer() (+53 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (34): BCinfo, Bigint, e, else, any_on(), b2d(), Balloc(), Bfree() (+26 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (44): BOOL, DWORD, HINSTANCE, LPVOID, pthread_key_t, pthread_mutex_t, jv_mem_alloc_unguarded(), jv_mem_calloc() (+36 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (97): jv_refcnt, jvp_array, jvp_literal_number, jvp_object, jvp_string, jv_mem_alloc(), jv_mem_free(), decNumber (+89 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (68): chclass, jq_util_input_state, jq_util_msg_cb, jv_parser, pfunc, FILE, clearerr(), fclose() (+60 more)

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (8): convert_manual_to_markdown(), dedent_body(), EscapeHtml, load_yml_file(), # TODO: properly parse this, RoffWalker, Extension, object

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (23): func_add_hook(), func_append_uniq(), func_echo_infix_1(), func_executable_p(), func_fatal_help(), func_help(), func_mode_help(), func_options() (+15 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (24): decimal32, decContextDefault(), decimal32Canonical(), decimal32FromNumber(), decimal32FromString(), decimal32IsCanonical(), decimal32Show(), decimal32ToEngString() (+16 more)

### Community 13 - "Community 13"
Cohesion: 0.25
Nodes (23): decApplyRound(), decCompare(), decCopyFit(), decDumpAr(), decExpOp(), decFinalize(), decFinish(), decGetInt() (+15 more)

### Community 14 - "Community 14"
Cohesion: 0.19
Nodes (20): decContextClearStatus(), decContextGetRounding(), decContextGetStatus(), decContextRestoreStatus(), decContextSaveStatus(), decContextSetRounding(), decContextSetStatus(), decContextSetStatusFromString() (+12 more)

### Community 15 - "Community 15"
Cohesion: 0.17
Nodes (11): Building from source, Community & Support, Cross-Compilation, Dependencies, Docker Image, Documentation, Installation, Instructions (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.18
Nodes (19): func_append_quoted(), func_echo(), func_extract_an_archive(), func_fatal_configuration(), func_fatal_error(), func_infer_tag(), func_lalib_unsafe_p(), func_mktempdir() (+11 more)

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (18): func_convert_core_file_wine_to_w32(), func_convert_core_msys_to_w32(), func_convert_core_path_wine_to_w32(), func_convert_file_check(), func_convert_file_cygwin_to_w32(), func_convert_file_msys_to_cygwin(), func_convert_file_msys_to_w32(), func_convert_file_nix_to_cygwin() (+10 more)

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (15): decimal64, decDigitsFromDPD(), decDigitsToDPD(), decimal64Canonical(), decimal64FromNumber(), decimal64FromString(), decimal64IsCanonical(), decimal64Show() (+7 more)

### Community 19 - "Community 19"
Cohesion: 0.17
Nodes (16): func_arith(), func_dll_def_p(), func_emit_cwrapperexe_src(), func_emit_wrapper(), func_extract_archives(), func_generate_dlsyms(), func_init_to_host_path_cmd(), func_len() (+8 more)

### Community 20 - "Community 20"
Cohesion: 0.13
Nodes (31): decFloatWider, decBiStr(), decFinalize(), decFloatFromBCD(), decFloatFromPacked(), decFloatFromPackedChecked(), decFloatFromString(), decFloatFromWider() (+23 more)

### Community 21 - "Community 21"
Cohesion: 0.21
Nodes (14): func_append(), func_check_version_match(), func_config(), func_enable_tag(), func_error(), func_features(), func_hookable(), func_missing_arg() (+6 more)

### Community 23 - "Community 23"
Cohesion: 0.40
Nodes (4): 1.7, CLI changes, Language changes, Previous releases

### Community 25 - "Community 25"
Cohesion: 0.32
Nodes (13): decimal128, decimal128Canonical(), decimal128FromNumber(), decimal128FromString(), decimal128IsCanonical(), decimal128Show(), decimal128ToEngString(), decimal128ToNumber() (+5 more)

### Community 31 - "Community 31"
Cohesion: 0.26
Nodes (13): func_execute_cmds(), func_generated_by_libtool_p(), func_lalib_p(), func_lo2o(), func_ltwrapper_executable_p(), func_ltwrapper_p(), func_ltwrapper_script_p(), func_ltwrapper_scriptname() (+5 more)

### Community 55 - "Community 55"
Cohesion: 0.70
Nodes (5): func_cygming_dll_for_implib_fallback(), func_cygming_gnu_implib_p(), func_cygming_ms_implib_p(), func_to_tool_file(), func_win32_libid()

## Knowledge Gaps
- **60 isolated node(s):** `UChar`, `regex_t`, `time_t`, `opcode`, `location` (+55 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `jvp_literal_number_new()` connect `Community 8` to `Community 12`, `Community 14`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `decNumberToString()` connect `Community 12` to `Community 8`, `Community 1`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `jv_free()` connect `Community 0` to `Community 2`, `Community 4`, `Community 7`, `Community 8`, `Community 9`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Are the 123 inferred relationships involving `jv_free()` (e.g. with `binop_divide()` and `binop_minus()`) actually correct?**
  _`jv_free()` has 123 INFERRED edges - model-reasoned connections that need verification._
- **Are the 90 inferred relationships involving `jv_copy()` (e.g. with `binop_minus()` and `binop_multiply()`) actually correct?**
  _`jv_copy()` has 90 INFERRED edges - model-reasoned connections that need verification._
- **Are the 101 inferred relationships involving `jv_get_kind()` (e.g. with `binop_divide()` and `binop_minus()`) actually correct?**
  _`jv_get_kind()` has 101 INFERRED edges - model-reasoned connections that need verification._
- **What connects `# TODO: properly parse this`, `UChar`, `regex_t` to the rest of the system?**
  _61 weakly-connected nodes found - possible documentation gaps or missing edges._
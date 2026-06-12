# Exploration discipline — Level 1 (trimmed toolbelt)

This repository has no code-knowledge graph and no explore sidekick. Find code with
plain text search, read the minimum, and edit. Keep exploration tight.

## Rules

- Locate first with `rg` (ripgrep). Search for the symbol, error string, config key,
  or test name that names the bug. Do not tour directories or list trees to "get
  oriented".
- Read only the file(s) the search points at, and only the relevant span — prefer
  `sed -n 'START,ENDp' file` or a ranged read over reading whole files. Do not open a
  file you have not already located by search.
- Once you can name the edit site, stop searching and make the change. Resist
  re-reading the same area for reassurance.
- Run the build/test only to verify your fix, with output redirected to a file you
  grep — never stream a full build log into the conversation.

The goal is a correct minimal patch with as little reading as possible.

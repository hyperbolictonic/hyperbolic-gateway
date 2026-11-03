---
type: Getting Started
title: Agent skills
description: Install the Hypagon Browser and Hypagon REST skills from GitHub.
tags: [skills, hermes, mcp, install]
status: stable
---

# Agent skills

The MCP servers provide the tools. The skills teach an agent which grouped tool
to use and give short, exact recipes.

## Hermes

Install from the raw GitHub URLs:

```bash
hermes skills install https://raw.githubusercontent.com/hyperbolictonic/hypagon/main/skills/hb-browser/SKILL.md
hermes skills install https://raw.githubusercontent.com/hyperbolictonic/hypagon/main/skills/hb-wrap/SKILL.md
```

With the Skills CLI:

```bash
npx skills add hyperbolictonic/hypagon --skill hb-browser
npx skills add hyperbolictonic/hypagon --skill hb-wrap
```

For a non-interactive global install, add `-g -y`.

## Other clients

Read the raw files directly:

- [`skills/hb-browser/SKILL.md`](../../skills/hb-browser/SKILL.md)
- [`skills/hb-wrap/SKILL.md`](../../skills/hb-wrap/SKILL.md)

The `hb-browser` server also exposes `help({ category: "skills" })` with the
same install URLs. MCP resources are not automatically installed as Hermes
skills.

## What the skills cover

- `hb-browser`: research → navigate → extract, observe → extract, find → act →
  observe, large-page reads through JEV (`jev_index` → `read_section`), form
  fill, debugging, human hand-off and recipe replay.
- `hb-wrap`: discover a wrapper, inspect its schema, dry-run it with `wrap_test`,
  call it with flat arguments, derive a response recipe, and keep credential
  values human-only.

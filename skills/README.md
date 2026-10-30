# Hyperbolic Gateway skills

Installable agent skills for the MCP servers in this repository.

## hb-browser

```bash
hermes skills install https://raw.githubusercontent.com/hyperbolictonic/hyperbolic-gateway/main/skills/hb-browser/SKILL.md
npx skills add hyperbolictonic/hyperbolic-gateway --skill hb-browser
```

## hb-wrap

```bash
hermes skills install https://raw.githubusercontent.com/hyperbolictonic/hyperbolic-gateway/main/skills/hb-wrap/SKILL.md
npx skills add hyperbolictonic/hyperbolic-gateway --skill hb-wrap
```

Add `-g -y` for a non-interactive global install:

```bash
npx skills add hyperbolictonic/hyperbolic-gateway --skill hb-browser -g -y
npx skills add hyperbolictonic/hyperbolic-gateway --skill hb-wrap -g -y
```

The MCP server supplies the tools; the skill teaches the client which grouped
tool to reach for and gives exact call recipes.

For clients that cannot install a skill from a URL, call
`help({category:"skills"})` on `hb-browser` for the install instructions, or
read the raw Markdown directly from GitHub.

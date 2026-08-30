---
name: chat-drawing
description: Use when a user asks Codex, Claude, OpenCode, or another agent to draw directly in a chat or CLI transcript with glyph-arts: ASCII/Unicode art, image-to-ASCII portraits, diagrams, flowcharts, sequence diagrams, PHART graphs, tables, dashboards, bar/line/scatter/heatmap charts, SDR spectrum/waterfall plots, or any request where the result must be visible in stdout instead of only saved to a file.
---

# Glyph Arts Chat Drawing

Project-local OMP adapter for the external Glyph Arts `chat-drawing` skill. The
canonical source remains `../../../../glyph-arts/skills/chat-drawing/SKILL.md`
(relative to this repository root); do not edit or vendor that source here.
Read its `references/decision-tree.md`, `references/routing.md`, and
`references/quality.md` when the request needs detailed routing or layout rules.

## Contract

When the user asks to draw, show, visualize, sketch, plot, diagram, preview, or
render inside the conversation:

1. Use `python -m cli_charts chat ...` first; run it from the external Glyph Arts
   checkout with `cd ../../../../glyph-arts` from this repository root.
2. Render to stdout with chat-safe output (no ANSI unless requested).
3. Verify stdout with `python skills/chat-drawing/scripts/verify_chat_art.py`.
4. On failure, rerender smaller or use a simpler fallback route.
5. Paste the verified stdout drawing itself into the reply in a fenced `text`
   block; mention files only as secondary artifacts.

## Routing

- Unknown JSON/JSONL/CSV/TSV: `python -m cli_charts chat incplot`
- Simple chart: `bar`, `line`, `scatter`, or `heatmap`
- Annotated/error-bar plot: `plotext`
- Function curve: `textplot`
- Drawille/Turtle path: `turtle`
- Mermaid source: `mermaid`
- Sequence/tree/math/table/frame/flowchart/DAG: `diagram <kind>`
- Network/DOT graph: `graph`
- Image/portrait: `image --file <path>`
- SDR: `sdr spectrum` or `waterfall`

Example from repository root:

```bash
cd ../../../../glyph-arts && python -m cli_charts chat diagram flowchart --json 'Capture -> Render -> Verify -> Reply' | python skills/chat-drawing/scripts/verify_chat_art.py --max-width 100 --require-label Capture
```

The adapter is intentionally not an OMP plugin and contains no copied Glyph
Arts implementation. Runtime availability still requires Glyph Arts' Python
dependencies in the execution environment.

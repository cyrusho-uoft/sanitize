# gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

If gstack skills aren't working, run `cd .claude/skills/gstack && ./setup` to build the binary and register skills.

## Available skills

- `/office-hours` - Office hours
- `/plan-ceo-review` - Plan CEO review
- `/plan-eng-review` - Plan engineering review
- `/plan-design-review` - Plan design review
- `/design-consultation` - Design consultation
- `/review` - Code review
- `/ship` - Ship code
- `/land-and-deploy` - Land and deploy
- `/canary` - Canary deployment
- `/benchmark` - Benchmarking
- `/browse` - Web browsing
- `/qa` - Quality assurance
- `/qa-only` - QA only
- `/design-review` - Design review
- `/setup-browser-cookies` - Set up browser cookies
- `/setup-deploy` - Set up deployment
- `/retro` - Retrospective
- `/investigate` - Investigate issues
- `/document-release` - Document a release
- `/codex` - Codex
- `/cso` - CSO
- `/careful` - Careful mode
- `/freeze` - Freeze
- `/guard` - Guard
- `/unfreeze` - Unfreeze
- `/gstack-upgrade` - Upgrade gstack

# Project rules

<!-- never-stale:begin v=0.10.1 hash=8279ccaaafedd0f0 -->
## Language
- **Spoken replies** to the user: always **Traditional Chinese (Hong Kong)**. Keep this unless the user explicitly asks to switch.
- **Written files** — `CLAUDE.md`, docs, specs, `README`s, code comments, commit messages: **English by default.**
- **Override:** if the user explicitly asks for a specific language for a given document, write that document in that language. An explicit request always wins over the default above.

## Doc maintenance
- After ANY code change, immediately sync the related docs (e.g. `README.md`, `CLAUDE.md`, design/spec docs). Don't wait to be asked.
- Before changing a feature, read the related docs first to confirm the current state.
- At the end of a round of changes, state clearly which docs were updated and which were not.

## Auto-compact note
- If this conversation just went through auto-compact: re-confirm the two rules above (spoken language + keep docs in sync) still apply.
- When unsure of the state, re-read this `CLAUDE.md` and the related docs; don't rely on chat memory.
<!-- never-stale:end -->

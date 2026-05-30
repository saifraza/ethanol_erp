# ADR 007: Native Claude Code skills + a single CLAUDE.md index

**Status**: Accepted (2026-05-31)
**Decision**: Reorganize `.claude/skills/` into native, auto-discovered Claude Code skills; move reference knowledge to `docs/`; make the CLAUDE.md routing table the sole index; retire the custom keyword hook; enforce the structure with a CI/smoke-test gate.

## Context
- `.claude/skills/` had grown to **36 flat `.md` files** plus one directory skill. None were valid Claude Code skills (a skill must be `<name>/SKILL.md` with YAML frontmatter), so none auto-loaded — even `design-system-kit/SKILL.md` lacked frontmatter.
- Discovery was faked by a `UserPromptSubmit` hook (`skill-matcher.py`) holding a hand-maintained regex→filename map — a parallel system that had to stay in sync with every rename.
- Three different things were jumbled together: procedural skills, reference/architecture docs, and incident postmortems. Invoicing (the hot path) was scattered across 4+ files.
- Two competing indexes (`SKILLS.md` + the CLAUDE.md routing table) drifted. Cross-references pointed at phantom filenames (`weighbridge-system.md`, `factory-linkage.md`). A duplicate skill copy lived in `.agents/`. The pre-commit hook pointed at a stale clone path; the pinned model id was stale.

## Decision
- **12 native skills**, each `.claude/skills/<name>/SKILL.md` (frontmatter `name` + pushy third-person `description`), lean (`< 300` lines) with deep detail in sibling `reference.md` / `lessons.md` / etc. Invoicing consolidates into one anchor skill, `ethanol-jobwork-billing`.
- **Reference knowledge → `docs/`**: `docs/modules/`, `docs/reference/`, `docs/design/`, `docs/postmortems/`, `docs/tech-debt-register.md`.
- **Single index**: the CLAUDE.md routing table. `SKILLS.md` deleted.
- **Retire the keyword hook**: `skill-matcher.py` unwired from `settings.json`; native description-based progressive disclosure replaces it (file kept one cycle for rollback, to delete after verification).
- **Hard gate**: `scripts/check-skills.sh` (run by `smoke-test.sh`) fails the push if a skill lacks frontmatter, exceeds 300 lines, a flat skill file appears, or a `SKILLS.md` reappears.
- **Anti-jumble conventions** (single-concern, point-don't-fork, one-location, no-secrets, quarterly review, DRI = Saif) recorded in CLAUDE.md.

## Why NOT alternatives
- **Keep the keyword hook**: redundant once skills are real; a permanent manual-sync burden that misses paraphrases native semantic matching catches.
- **Keep everything under `.claude/skills/` as docs**: conflates trigger-able procedures with reference material and bloats startup context; reference belongs in `docs/`.
- **Make `module-index` a skill**: it is a reference catalog, and a second index competes with CLAUDE.md — kept as `docs/modules/module-index.md`.

## Consequences
- New skills must be single-concern `<name>/SKILL.md` with frontmatter; grow by splitting, never by appending "Part A–H".
- Adding a module spec → write it in `docs/modules/`, not as a skill.
- Credentials never go in skills/docs — reference the out-of-git fleet doc.
- **Follow-ups**: (1) confirm native triggering in a fresh session, then delete `skill-matcher.py`; (2) a separate comments-only PR to repoint ~20 stale `.claude/skills/*.md` references in source-code comments (some point at the never-existent `weighment-corrections.md` → now `weighbridge/corrections-spec.md`); (3) remove the duplicate `.agents/` skill copy, stale worktrees, and cloud-sync dupes (now gitignored).

#!/usr/bin/env bash
# check-skills.sh — anti-jumble gate for the .claude/skills system.
# Enforces the contract in CLAUDE.md ("Skills & docs system — conventions").
# Run standalone or via smoke-test.sh. Exits 1 on any violation.
#
# Rules enforced:
#   1. No SKILLS.md  — the CLAUDE.md routing table is the ONLY index.
#   2. No flat *.md skills directly under .claude/skills/ — a skill is <name>/SKILL.md.
#   3. Every skill dir has a SKILL.md whose first line is YAML frontmatter (---).
#   4. That frontmatter declares `name:` and `description:`.
#   5. SKILL.md is < 300 lines (grow by splitting into reference files, not appending).

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS="$ROOT/.claude/skills"
MAX_LINES=300
FAIL=0

err() { echo "  FAIL  $1"; FAIL=1; }

[[ -d "$SKILLS" ]] || { echo "  FAIL  $SKILLS not found"; exit 1; }

# 1. No competing index
[[ -e "$SKILLS/SKILLS.md" ]] && err "SKILLS.md exists — the CLAUDE.md routing table is the only index; delete it"

# 2. No flat skill files
while IFS= read -r flat; do
  [[ -n "$flat" ]] && err "flat file in .claude/skills/ (skills must be <name>/SKILL.md): ${flat#"$ROOT"/}"
done < <(find "$SKILLS" -maxdepth 1 -type f -name '*.md' 2>/dev/null)

# 3-5. Each skill dir well-formed
shopt -s nullglob
for d in "$SKILLS"/*/; do
  name=$(basename "$d")
  f="${d}SKILL.md"
  if [[ ! -f "$f" ]]; then
    err "$name/ has no SKILL.md"
    continue
  fi
  [[ "$(head -1 "$f")" == "---" ]] || err "$name/SKILL.md must start with YAML frontmatter (---) on line 1"
  fm=$(awk 'NR==1&&/^---/{f=1;next} f&&/^---/{exit} f{print}' "$f")
  echo "$fm" | grep -q '^name:'        || err "$name/SKILL.md frontmatter missing 'name:'"
  echo "$fm" | grep -q '^description:' || err "$name/SKILL.md frontmatter missing 'description:'"
  lines=$(wc -l < "$f" | tr -d ' ')
  (( lines >= MAX_LINES )) && err "$name/SKILL.md is $lines lines (>= $MAX_LINES — split detail into reference files)"
done

if (( FAIL == 0 )); then
  count=$(find "$SKILLS" -name SKILL.md | wc -l | tr -d ' ')
  echo "  OK    $count skills, all well-formed (frontmatter present, < $MAX_LINES lines, no flat files / SKILLS.md)"
fi
exit $FAIL

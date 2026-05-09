#!/usr/bin/env python3
"""
UserPromptSubmit hook — keyword-matches the user's prompt against the
.claude/skills/ index and surfaces the relevant skill paths to Claude as
additional context. Designed to be silent + fast (no skill content is
included, just pointers — Claude can Read them on demand).

Hook input (stdin, JSON):
    { "session_id": "...", "transcript_path": "...",
      "hook_event_name": "UserPromptSubmit", "prompt": "..." }

Hook output (stdout, JSON):
    {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit",
                             "additionalContext": "..."}}
    Claude Code injects `additionalContext` as a system reminder BEFORE
    Claude reads the prompt. We stay silent (no output) if the keyword
    scan finds nothing — chitchat shouldn't trigger noise.
"""

import json
import re
import sys

# Keyword → skill map. Each key is a regex pattern (case-insensitive,
# matched as a word boundary against the prompt). Each value is a list of
# skill filenames in .claude/skills/. Keep this map small + curated;
# noisy matches train Claude to ignore the hook output.
SKILL_MAP = [
    # ── Critical / safety-first ──────────────────────────────────────
    (r"\b(prisma db push|accept-data-loss|drop column|drop table|truncate|pg_restore|destructive (sql|migration)|db damage)\b",
     ["incident-2026-04-16-db-damage.md"]),

    # ── Factory + hardware ───────────────────────────────────────────
    (r"\b(factory|factory-server|gate entry|weighbridge pc|wb pc|tailscale 100\.|192\.168\.0\.10)\b",
     ["factory-operations.md"]),
    (r"\b(weighbridge|weighment|wb|tare|gross|first weight|second weight|kata|scale|com port|serial)\b",
     ["weighbridge.md"]),
    (r"\b(opc|dcs|distillation tag|process tag|honeywell|opc bridge)\b",
     ["opc-bridge.md"]),
    (r"\b(camera|truck identity|anti.?cheat|wb vision|rtsp|dahua)\b",
     ["wb-vision-anti-cheat.md"]),
    (r"\b(training data|training event|training viewer)\b",
     ["wb-training-viewer.md"]),

    # ── Process / production ─────────────────────────────────────────
    (r"\b(grain intake|fermentation|distillation|pf cap|fermenter|beer well|process production)\b",
     ["process-production.md"]),
    (r"\b(ethanol supply|gen invoice|lifting irn|ethanol postmortem)\b",
     ["ethanol-supply-postmortem.md"]),

    # ── Business modules ─────────────────────────────────────────────
    (r"\b(payment|pay (vendor|contractor|po|wo|bill)|paymentsout|payment-out|outstanding|cash voucher|vendor payment|contractor payment|transporter payment)\b",
     ["payments-architecture.md"]),
    (r"\b(email|smtp|imap|gmail|send-email|send-rfq|email thread|mail (queue|reply)|email pipeline|nodemailer|messageId|inReplyTo)\b",
     ["email-pipeline.md"]),
    (r"\b(upload|multer|s3|bucket|neat-shelf|storage health|file upload|mirrorTos3|backup uploads)\b",
     ["uploads-s3-mirror.md"]),
    (r"\b(grn|goods receipt|auto grn|store grn|grn split)\b",
     ["grn-split-auto-vs-store.md", "procurement-module.md"]),
    (r"\b(ethanol jobwork|job work|odisha|mash bio|ethanol billing)\b",
     ["ethanol-jobwork-billing.md"]),
    (r"\b(sales order|invoice|e-invoice|e.way|eway|dispatch|shipment)\b",
     ["sales-module.md"]),
    (r"\b(purchase order|\bpo\b|procurement|vendor invoice|p2p)\b",
     ["procurement-module.md"]),
    (r"\b(indent|requisition|\bpr\b|rfq|quote|award vendor)\b",
     ["procurement-module.md"]),
    (r"\b(inventory|stock|warehouse|store master|inventory item|movement|cycle count)\b",
     ["inventory-module.md"]),
    (r"\b(trade purchase|trade sale|trade inventory)\b",
     ["trade-inventory.md"]),
    (r"\b(contractor|thakedar|contractor bill|contractor issue|work order|\bwo\b|manpower|transport contract)\b",
     ["contractors-thakedar.md"]),
    (r"\b(dashboard|kpi|analytics)\b",
     ["dashboard-analytics.md"]),
    (r"\b(sister compan|mael|mgal|inter.?company)\b",
     ["sister-companies.md"]),
    (r"\b(accounts|journal|chart of accounts|p.?l|balance sheet|bank recon|trial balance)\b",
     ["accounts-module.md"]),

    # ── Compliance / tax / banking ───────────────────────────────────
    (r"\b(compliance|tds|gstr|gst return|payroll|roc|epf|esi)\b",
     ["compliance-tax-system.md"]),
    (r"\b(ubi|h2h|bank payment|sftp|maker.?checker)\b",
     ["ubi-h2h-banking.md"]),
    (r"\b(eway bill job|ewb job|job work eway)\b",
     ["ewb-jobwork-issue.md"]),

    # ── Operations CLI ───────────────────────────────────────────────
    (r"\b(correct weighment|cancel weighment|edit weighment|reweigh)\b",
     ["correct-weighment.md"]),
    (r"\b(check ticket|lookup ticket|pull ticket|ticket #?\d+|ticket number)\b",
     ["ticket-lookup.md"]),

    # ── Infra / deploy ───────────────────────────────────────────────
    (r"\b(dockerfile|docker build|railway build|deploy fail|chromium|puppeteer (launch|pdf)|build chain|nixpacks|railpack)\b",
     ["deploy-dockerfile-railway.md"]),

    # ── System-wide / reference ──────────────────────────────────────
    (r"\b(chart|graph|recharts|line chart|bar chart|pie chart)\b",
     ["charts-graphs.md"]),
    (r"\b(auth|user role|permission|allowedmodule|admin setting)\b",
     ["admin-settings.md"]),
    (r"\b(tech debt|technical debt|debt register)\b",
     ["debt-register.md"]),
    (r"\b(code template|new route|new page|asynchandler|nowist)\b",
     ["code-templates.md"]),
    (r"\b(sap design|design token|tier 2|tier two|tailwind class)\b",
     ["sap-design-tokens.md"]),
    (r"\b(module index|module list|module maturity)\b",
     ["module-index.md"]),
    (r"\b(invoice snapshot|invoice immutab|frozen invoice|irn snapshot)\b",
     ["invoice-snapshot-immutability.md"]),
    (r"\b(video|veo|gemini video|promo video)\b",
     ["video-generation.md"]),
]


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        # Bad input — stay silent, never block the prompt.
        return 0

    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        return 0

    matched: list[str] = []
    seen: set[str] = set()
    for pattern, skills in SKILL_MAP:
        if re.search(pattern, prompt, re.IGNORECASE):
            for s in skills:
                if s not in seen:
                    seen.add(s)
                    matched.append(s)

    if not matched:
        return 0

    # Cap at 5 — anything more is noise.
    matched = matched[:5]
    lines = [f"  • .claude/skills/{name}" for name in matched]
    context = (
        f"Skill matcher hook — keyword-matched {len(matched)} skill(s) for this prompt. "
        f"Read these before substantive code work on the topic:\n"
        + "\n".join(lines)
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())

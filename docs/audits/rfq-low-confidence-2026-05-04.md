# RFQ Low-Confidence Discard — Audit (Codex)

Date: 2026-05-04
Auditor: Codex (gpt-5)
Triggered by: 5th repeat hit on "AI could not read the rates confidently — please enter them manually below" after PRs #4, #5, #6, #9.

## Diagnosis

**Q1.** Drop the LOW persistence gate. The failure is policy, not parsing: extractor returns structured JSON unchanged after parse (`backend/src/services/rfqQuoteExtractor.ts:307-312`) under schema (`246-270`). The route then deliberately skips all line/cost persistence when confidence is LOW (`backend/src/routes/purchaseRequisition.ts:929-934`). Confidence is model self-report (`rfqQuoteExtractor.ts:169,268`), so prompt tuning is another brittle patch.

**Q2.** Minimum fix for the line-rates button: route + frontend labels. Remove LOW from `purchaseRequisition.ts:934`, write a confidence-aware source at `946-947`, and let cost fields persist at `958-976`. For "remove the mechanism," also change `rfqAutoExtract.ts:100-102`; otherwise background extraction still silently discards LOW. No scoring change needed in `rfqQuoteExtractor`.

**Q3.** Harm is real: award uses saved line rate/GST/HSN/discount directly (`purchaseRequisition.ts:437-457`), cost components flow into PO charges (`488-510`), award only checks `vendorRate > 0` (`391-394`), and vendor history updates (`408-413`). **Guardrail: persist LOW visibly as `EMAIL_AUTO_LOW`, then block or explicitly confirm award when priced lines/header source are LOW.** That avoids silent discard while preventing accidental PO/accounting impact.

**Q4.** Yes. Drawer extraction stores `res.data.extracted` regardless of confidence (`PurchaseRequisition.tsx:717-723`) and preview renders whenever present (`1964-1976`, table `1976-2000`). Line-rates differs because it reloads persisted rows (`290`); backend saved none, so UI shows the LOW/no-save error (`292-299`).

**Q5.** Use `EMAIL_AUTO_LOW`. Header recompute propagates a single line source to `quoteSource` (`purchaseRequisition.ts:132-158`; background `rfqAutoExtract.ts:193-219`), making LOW AI queryable downstream.

## One-shot patch plan

1. `backend/src/routes/purchaseRequisition.ts:934` — change to `if (req.body.autoApply && indentLines.length > 0)`.
2. `purchaseRequisition.ts:937` — add `const aiSource = extracted.confidence === 'LOW' ? 'EMAIL_AUTO_LOW' : 'EMAIL_AUTO';`.
3. `purchaseRequisition.ts:946-947` — replace `source: 'EMAIL_AUTO'` with `source: aiSource`.
4. `purchaseRequisition.ts:386-394` — block or require explicit confirm when awarding `EMAIL_AUTO_LOW`.
5. `backend/src/services/rfqAutoExtract.ts:100-102` — remove LOW discard or persist as `EMAIL_AUTO_LOW` with the same award guardrail.
6. `frontend/src/pages/PurchaseRequisition.tsx` — add `EMAIL_AUTO_LOW: 'AI LOW'` amber badge.
7. `PurchaseRequisition.tsx:1577-1580` — show amber "verify before award/save" banner for `EMAIL_AUTO_LOW`.
8. `backend/prisma/schema.prisma` — update source-field comments to include `EMAIL_AUTO_LOW`; no migration needed (column is free-form string).

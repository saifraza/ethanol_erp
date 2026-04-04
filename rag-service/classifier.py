"""
Auto-categorization of uploaded documents using Gemini.
Analyzes document text and returns structured metadata.
"""

import json
import asyncio
from google import genai
from google.genai import types

CATEGORIES = [
    "COMPLIANCE", "LICENSE", "CERTIFICATE", "CONTRACT",
    "INSURANCE", "HR", "LEGAL", "BANK", "OTHER",
]

SUBCATEGORIES = {
    "COMPLIANCE": ["EC", "POLLUTION_CERT", "CONSENT_TO_OPERATE", "CONSENT_TO_ESTABLISH", "HAZARDOUS_WASTE"],
    "LICENSE": ["FACTORY_LICENSE", "EXCISE_LICENSE", "TRADE_LICENSE", "DRUG_LICENSE"],
    "CERTIFICATE": ["BOILER_CERT", "PESO_APPROVAL", "FIRE_NOC", "BIS_CERT", "ISO_CERT", "FOOD_SAFETY"],
    "CONTRACT": ["VENDOR_AGREEMENT", "SERVICE_AGREEMENT", "LEASE", "MOU", "SUPPLY_CONTRACT", "JOB_WORK"],
    "INSURANCE": ["FIRE_INSURANCE", "VEHICLE_INSURANCE", "WORKMAN_COMP", "LIABILITY"],
    "HR": ["APPOINTMENT_LETTER", "POLICY", "PF_REGISTRATION", "ESI_REGISTRATION"],
    "LEGAL": ["COURT_ORDER", "GOVERNMENT_ORDER", "NOTICE", "AFFIDAVIT"],
    "BANK": ["LOAN_AGREEMENT", "GUARANTEE", "SANCTION_LETTER", "HYPOTHECATION"],
}

CLASSIFY_PROMPT = """Analyze this document and extract metadata. Return ONLY valid JSON with these keys:

{{
  "category": "one of: {categories}",
  "subcategory": "specific type within the category, e.g. EC, FACTORY_LICENSE, JOB_WORK, etc.",
  "title": "short descriptive title for this document",
  "tags": "comma-separated relevant tags/keywords",
  "issuedBy": "issuing authority or organization name",
  "issuedDate": "YYYY-MM-DD format if found, null otherwise",
  "expiryDate": "YYYY-MM-DD format if found, null otherwise",
  "referenceNo": "document reference/certificate/license number if found",
  "department": "relevant department (Operations, Accounts, HR, Legal, etc.)",
  "summary": "1-2 sentence summary of the document's purpose"
}}

Available subcategories per category: {subcategories}

If a field is not found in the document, use null.
Return ONLY the JSON, no markdown fences, no explanation.

Document text:
{text}"""


async def classify_document(text: str, gemini_key: str) -> dict:
    """Send document text to Gemini for auto-categorization."""
    client = genai.Client(api_key=gemini_key)

    # Use first 4000 chars for classification (enough for most docs)
    truncated = text[:4000]

    prompt = CLASSIFY_PROMPT.format(
        categories=", ".join(CATEGORIES),
        subcategories=json.dumps(SUBCATEGORIES, indent=2),
        text=truncated,
    )

    response = await asyncio.to_thread(
        client.models.generate_content,
        model="gemini-2.5-flash",
        contents=[types.Content(role="user", parts=[types.Part.from_text(prompt)])],
        config=types.GenerateContentConfig(temperature=0.0, max_output_tokens=1024),
    )

    raw = response.text or ""
    # Strip markdown fences if present
    cleaned = raw.replace("```json", "").replace("```", "").strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {"category": "OTHER", "title": "Unclassified Document", "raw": raw}

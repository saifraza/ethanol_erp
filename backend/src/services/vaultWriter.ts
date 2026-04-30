/**
 * Vault Writer — Auto-generates Obsidian-style markdown summaries from uploaded documents.
 *
 * Flow: Upload doc → Gemini summarizes → categorize → write VaultNote to DB
 *       → local sync script pulls to ~/Documents/mspil-brain/
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import prisma from '../config/prisma';
import { lightragInsertText, isRagEnabled } from './lightragClient';

const GEMINI_KEY = process.env.GEMINI_API_KEY;

// ── Category mapping from CompanyDocument categories ──
const CATEGORY_MAP: Record<string, string> = {
  COMPLIANCE: 'compliance',
  LICENSE: 'compliance',
  CERTIFICATE: 'compliance',
  CONTRACT: 'contracts',
  INSURANCE: 'contracts',
  HR: 'hr',
  LEGAL: 'legal',
  BANK: 'bank',
  OTHER: 'other',
};

// ── Gemini document summarization ──
async function summarizeWithGemini(
  fileBuffer: Buffer,
  mimeType: string,
  docTitle: string,
  docCategory: string
): Promise<{ summary: string; entities: Record<string, any> } | null> {
  if (!GEMINI_KEY) return null;

  const prompt = `You are analyzing a document titled "${docTitle}" (category: ${docCategory}) for an ethanol distillery (MSPIL, Narsinghpur, MP, India).

Generate a structured summary in this exact JSON format:
{
  "title": "Clear descriptive title",
  "summary": "3-5 bullet points summarizing the document. Include key dates, amounts, parties, obligations. Use markdown bullet format (- item).",
  "key_dates": [{"label": "description", "date": "YYYY-MM-DD"}],
  "parties": ["Party 1", "Party 2"],
  "key_amounts": [{"label": "description", "amount": "value with currency"}],
  "obligations": ["Obligation 1", "Obligation 2"],
  "related_topics": ["topic1", "topic2"]
}

Return ONLY valid JSON, no markdown fences.`;

  try {
    const base64 = fileBuffer.toString('base64');
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType.startsWith('image/') ? mimeType : 'application/pdf', data: base64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 2000 },
      },
      { timeout: 60000 }
    );

    const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      summary: parsed.summary || '',
      entities: {
        key_dates: parsed.key_dates || [],
        parties: parsed.parties || [],
        key_amounts: parsed.key_amounts || [],
        obligations: parsed.obligations || [],
        related_topics: parsed.related_topics || [],
      },
    };
  } catch (err: any) {
    console.error('[VaultWriter] Gemini summarization failed:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// ── Generate wiki-links from entities + existing vault notes ──
async function generateWikiLinks(entities: Record<string, any>): Promise<string[]> {
  const links: string[] = [];

  // 1. Links from Gemini-extracted topics
  const topics = entities.related_topics || [];
  for (const topic of topics) {
    const normalized = topic.toLowerCase().replace(/\s+/g, '-');
    links.push(`[[${normalized}]]`);
  }

  // 2. Match parties/entities against existing vault note titles
  const parties = entities.parties || [];
  if (parties.length > 0) {
    try {
      const existingNotes = await prisma.vaultNote.findMany({
        select: { title: true, vaultPath: true },
      
    take: 500,
  });

      for (const party of parties) {
        const partyLower = party.toLowerCase();
        for (const note of existingNotes) {
          if (note.title.toLowerCase().includes(partyLower) ||
              partyLower.includes(note.title.toLowerCase())) {
            const noteSlug = note.vaultPath.replace(/\.md$/, '').split('/').pop();
            if (noteSlug && !links.includes(`[[${noteSlug}]]`)) {
              links.push(`[[${noteSlug}]]`);
            }
          }
        }
      }
    } catch {
      // DB query failed — continue with topic-based links only
    }
  }

  // 3. Auto-link to known module pages based on category keywords
  const moduleKeywords: Record<string, string> = {
    compliance: 'gst-compliance',
    gst: 'gst-compliance',
    pollution: 'production',
    environment: 'production',
    vendor: 'procurement',
    supplier: 'procurement',
    purchase: 'procurement',
    contract: 'sales',
    ethanol: 'production',
    bank: 'accounts',
    loan: 'accounts',
    payment: 'payment-terms',
    insurance: 'contracts',
  };

  const allText = JSON.stringify(entities).toLowerCase();
  for (const [keyword, target] of Object.entries(moduleKeywords)) {
    if (allText.includes(keyword) && !links.includes(`[[${target}]]`)) {
      links.push(`[[${target}]]`);
    }
  }

  return [...new Set(links)]; // deduplicate
}

// ── Build markdown content ──
async function buildMarkdown(
  title: string,
  category: string,
  sourceType: string,
  summary: string,
  entities: Record<string, any>,
  docMeta: { issuedBy?: string; issuedDate?: string; expiryDate?: string; referenceNo?: string }
): Promise<string> {
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`**Category**: ${category}`);
  lines.push(`**Source**: ${sourceType}`);
  if (docMeta.referenceNo) lines.push(`**Reference**: ${docMeta.referenceNo}`);
  if (docMeta.issuedBy) lines.push(`**Issued By**: ${docMeta.issuedBy}`);
  if (docMeta.issuedDate) lines.push(`**Issued**: ${docMeta.issuedDate}`);
  if (docMeta.expiryDate) lines.push(`**Expires**: ${docMeta.expiryDate}`);
  lines.push('');

  lines.push('## Summary');
  lines.push(summary);
  lines.push('');

  // Key dates
  const dates = entities.key_dates || [];
  if (dates.length > 0) {
    lines.push('## Key Dates');
    for (const d of dates) {
      lines.push(`- **${d.label}**: ${d.date}`);
    }
    lines.push('');
  }

  // Parties
  const parties = entities.parties || [];
  if (parties.length > 0) {
    lines.push('## Parties');
    for (const p of parties) {
      lines.push(`- ${p}`);
    }
    lines.push('');
  }

  // Amounts
  const amounts = entities.key_amounts || [];
  if (amounts.length > 0) {
    lines.push('## Key Amounts');
    for (const a of amounts) {
      lines.push(`- **${a.label}**: ${a.amount}`);
    }
    lines.push('');
  }

  // Obligations
  const obligations = entities.obligations || [];
  if (obligations.length > 0) {
    lines.push('## Obligations');
    for (const o of obligations) {
      lines.push(`- ${o}`);
    }
    lines.push('');
  }

  // Wiki links
  const wikiLinks = await generateWikiLinks(entities);
  if (wikiLinks.length > 0) {
    lines.push('## Related');
    lines.push(wikiLinks.join(' | '));
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Auto-generated on ${new Date().toISOString().split('T')[0]}*`);

  return lines.join('\n');
}

// ── Slugify filename ──
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// ── Main: Generate vault note from uploaded document ──
export async function generateVaultNote(opts: {
  sourceType: string;
  sourceId: string;
  filePath: string; // relative path under uploads/
  title: string;
  category: string;
  mimeType?: string;
  issuedBy?: string;
  issuedDate?: string;
  expiryDate?: string;
  referenceNo?: string;
}): Promise<void> {
  try {
    // Read file — support both relative (under uploads/) and absolute paths
    const absPath = path.isAbsolute(opts.filePath)
      ? opts.filePath
      : path.resolve(__dirname, '../../uploads', opts.filePath);
    if (!fs.existsSync(absPath)) {
      console.error('[VaultWriter] File not found:', absPath);
      return;
    }

    const fileBuffer = fs.readFileSync(absPath);
    const contentHash = crypto.createHash('md5').update(fileBuffer).digest('hex');

    // Check if already generated with same content
    const existing = await prisma.vaultNote.findFirst({
      where: { sourceType: opts.sourceType, sourceId: opts.sourceId },
    });
    if (existing && existing.contentHash === contentHash) {
      console.log('[VaultWriter] Skipping — content unchanged for', opts.title);
      return;
    }

    // Summarize with Gemini
    const mimeType = opts.mimeType || 'application/pdf';
    const result = await summarizeWithGemini(fileBuffer, mimeType, opts.title, opts.category);
    if (!result) {
      console.error('[VaultWriter] Could not summarize:', opts.title);
      return;
    }

    // Determine vault path
    const vaultCategory = CATEGORY_MAP[opts.category.toUpperCase()] || 'other';
    const slug = slugify(opts.title);
    const vaultPath = `erp/documents/${vaultCategory}/${slug}.md`;

    // Build markdown
    const markdown = await buildMarkdown(
      opts.title,
      vaultCategory,
      opts.sourceType,
      result.summary,
      result.entities,
      {
        issuedBy: opts.issuedBy,
        issuedDate: opts.issuedDate,
        expiryDate: opts.expiryDate,
        referenceNo: opts.referenceNo,
      }
    );

    // Upsert vault note in DB
    const noteData = {
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
      vaultPath,
      title: opts.title,
      category: vaultCategory,
      summary: markdown,
      entities: JSON.stringify(result.entities),
      contentHash,
      ragIndexed: false,
      synced: false,
    };

    if (existing) {
      await prisma.vaultNote.update({
        where: { id: existing.id },
        data: { ...noteData, synced: false },
      });
    } else {
      await prisma.vaultNote.create({ data: noteData });
    }

    // Also index the summary into LightRAG for enriched search
    if (isRagEnabled()) {
      try {
        await lightragInsertText(`[Vault Summary] ${opts.title}\n\n${markdown}`, {
          sourceType: 'VaultNote',
          sourceId: opts.sourceId,
        });
      } catch (err) {
        console.error('[VaultWriter] LightRAG summary indexing failed:', err);
      }
    }

    console.log('[VaultWriter] Generated vault note:', vaultPath);
  } catch (err: any) {
    console.error('[VaultWriter] Error generating vault note:', err.message);
  }
}

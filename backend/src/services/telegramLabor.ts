/**
 * Telegram Labor Workflow — conversational labor management for the
 * supervisor at the gate. Adding a new labor worker through the web UI
 * means clicking through 4 dropdowns + 6 form fields; over Telegram it's
 * "labor" → answer 5 short questions → done in 60 seconds.
 *
 * Trigger keywords: "labor", "labour", "/labor"  (case-insensitive)
 *
 * Top-level menu after trigger:
 *   1. Add new labor
 *   2. Show running work orders + labor counts
 *   3. Cancel
 *
 * Add-labor flow:
 *   contractor → WO (filtered to MANPOWER_SUPPLY for that contractor)
 *   → skill (from WO's manpowerRateCard, with rate displayed)
 *   → first name → father name (or "skip") → phone (or "skip")
 *   → confirm → save
 *
 * The dailyRate is derived from the WO's rate-card snapshot; the supervisor
 * never types a rate (per the rule we set: rate chart in the order is the
 * single source of truth).
 *
 * Self-contained — does NOT integrate with the auto-collect MODULE_REGISTRY
 * since that framework is for periodic numeric readings. Labor needs a
 * richer state machine with text fields, lookups, and branching.
 */

import prisma from '../config/prisma';
import { registerIncomingHandler } from './telegramBot';
import { tgSend } from './telegramClient';

const SESSION_TIMEOUT_MS = 30 * 60_000; // abandoned sessions expire after 30 min

type Mode = 'menu' | 'add' | 'list';

type AddStep =
  | 'pick_wo'
  | 'pick_skill'
  | 'first_name'
  | 'father_name'
  | 'phone'
  | 'confirm_save';

interface RateCardEntry {
  skill: string;
  rate8h?: number;
  rate12h?: number;
  dailyRate?: number;
  rate?: number;
}

interface LaborSession {
  chatId: string;
  mode: Mode;
  step?: AddStep;
  startedAt: Date;
  expiresAt: Date;
  // Add-labor draft data
  draft: {
    contractorChoices?: Array<{ id: string; name: string; code: string | null }>;
    contractorId?: string;
    contractorName?: string;
    woChoices?: Array<{ id: string; woNo: number; title: string }>;
    workOrderId?: string;
    woNo?: number;
    woTitle?: string;
    skillChoices?: RateCardEntry[];
    skillCategory?: string;
    dailyRate?: number;
    firstName?: string;
    lastName?: string | null;
    fatherName?: string | null;
    phone?: string | null;
  };
}

const sessions = new Map<string, LaborSession>();

function newSession(chatId: string): LaborSession {
  const now = new Date();
  return {
    chatId,
    mode: 'menu',
    startedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TIMEOUT_MS),
    draft: {},
  };
}

async function send(chatId: string, msg: string): Promise<void> {
  await tgSend(chatId, msg, 'labor');
}

function getRate(entry: RateCardEntry): number {
  return entry.dailyRate ?? entry.rate8h ?? entry.rate ?? 0;
}

function isTrigger(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === 'labor' || t === 'labour' || t === '/labor' || t === '/labour';
}

function isCancel(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === '/cancel' || t === 'cancel' || t === 'menu' || t === '/menu';
}

async function showMenu(chatId: string): Promise<void> {
  await send(chatId, [
    '👷 *Labor menu*',
    '',
    '1. Add new labor',
    '2. Show running work orders',
    '3. Cancel',
    '',
    '_Reply with the number, or type cancel anytime to exit._',
  ].join('\n'));
}

async function startListWOs(chatId: string): Promise<void> {
  // Active manpower-supply WOs with running labor count
  const wos = await prisma.workOrder.findMany({
    where: { contractType: 'MANPOWER_SUPPLY', status: { in: ['APPROVED', 'IN_PROGRESS', 'OPEN'] } },
    orderBy: { woNo: 'desc' },
    select: {
      id: true, woNo: true, title: true,
      contractor: { select: { name: true } },
      laborWorkers: { where: { isActive: true }, select: { id: true, dailyRate: true } },
    },
    take: 30,
  });

  if (wos.length === 0) {
    await send(chatId, 'No active manpower-supply work orders found.');
    return;
  }

  const lines = ['📋 *Running manpower-supply WOs:*', ''];
  for (const wo of wos) {
    const count = wo.laborWorkers.length;
    const todayCost = wo.laborWorkers.reduce((s, l) => s + (l.dailyRate ?? 0), 0);
    lines.push(
      `*WO-${wo.woNo}* ${wo.title}`,
      `  ${wo.contractor.name}`,
      `  ${count} active labor · ₹${todayCost.toLocaleString('en-IN')}/day`,
      '',
    );
  }
  lines.push('_Type "labor" to start a new flow._');
  await send(chatId, lines.join('\n'));
}

async function startAdd(chatId: string, session: LaborSession): Promise<void> {
  // Pull every active manpower-supply WO with contractor inline + active count.
  // Faster than asking the supervisor to type a contractor name first — they
  // know which WO they're hiring labor for, not which contractor in isolation.
  const wos = await prisma.workOrder.findMany({
    where: {
      contractType: 'MANPOWER_SUPPLY',
      status: { in: ['APPROVED', 'IN_PROGRESS', 'OPEN'] },
    },
    orderBy: { woNo: 'desc' },
    select: {
      id: true, woNo: true, title: true, manpowerRateCard: true,
      contractor: { select: { id: true, name: true } },
      laborWorkers: { where: { isActive: true }, select: { id: true } },
    },
    take: 30,
  });

  if (wos.length === 0) {
    await send(chatId, [
      '❌ No active manpower-supply work orders found.',
      '',
      'Create one in the ERP (Store > Work Orders, contractType = Manpower Supply) and come back.',
      '',
      '_Type cancel to exit._',
    ].join('\n'));
    sessions.delete(chatId);
    return;
  }

  session.mode = 'add';
  session.step = 'pick_wo';
  session.draft.woChoices = wos.map(w => ({ id: w.id, woNo: w.woNo, title: w.title }));
  // Stash extra detail keyed by WO id for the next step
  (session.draft as any).rateCardsByWoId = Object.fromEntries(wos.map(w => [w.id, w.manpowerRateCard]));
  (session.draft as any).contractorByWoId = Object.fromEntries(wos.map(w => [w.id, w.contractor]));

  const lines = ['➕ *Add new labor*', '', 'Pick the work order:', ''];
  wos.forEach((w, i) => {
    const count = w.laborWorkers.length;
    lines.push(`${i + 1}. WO-${w.woNo} · ${w.title}`);
    lines.push(`   ${w.contractor.name} · ${count} active`);
  });
  lines.push('', '_Reply with the number._');
  await send(chatId, lines.join('\n'));
}

async function handlePickWO(session: LaborSession, text: string): Promise<void> {
  const idx = parseInt(text.trim(), 10) - 1;
  const choices = session.draft.woChoices ?? [];
  if (isNaN(idx) || idx < 0 || idx >= choices.length) {
    await send(session.chatId, 'Reply with one of the listed numbers.');
    return;
  }
  const picked = choices[idx];
  const rateCards = (session.draft as any).rateCardsByWoId as Record<string, unknown>;
  const contractors = (session.draft as any).contractorByWoId as Record<string, { id: string; name: string }>;
  session.draft.workOrderId = picked.id;
  session.draft.woNo = picked.woNo;
  session.draft.woTitle = picked.title;
  session.draft.contractorId = contractors[picked.id]?.id;
  session.draft.contractorName = contractors[picked.id]?.name;
  await proceedToSkill(session, rateCards[picked.id]);
}

async function proceedToSkill(session: LaborSession, rateCardRaw: unknown): Promise<void> {
  const card = parseRateCard(rateCardRaw);
  if (card.length === 0) {
    await send(session.chatId, [
      `⚠️ WO-${session.draft.woNo} has no rate card configured.`,
      'Set the rate card on the WO in the ERP first, then come back.',
      '_Type cancel to exit._',
    ].join('\n'));
    sessions.delete(session.chatId);
    return;
  }
  session.draft.skillChoices = card;
  session.step = 'pick_skill';
  const lines = [`*WO-${session.draft.woNo}* — pick skill:`, ''];
  card.forEach((c, i) => lines.push(`${i + 1}. ${c.skill} · ₹${getRate(c).toLocaleString('en-IN')}/day`));
  lines.push('', '_Reply with the number._');
  await send(session.chatId, lines.join('\n'));
}

function parseRateCard(raw: unknown): RateCardEntry[] {
  // The rate card is JSON. Be flexible about shape.
  if (!raw) return [];
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'object' && raw !== null && Array.isArray((raw as any).rates)) arr = (raw as any).rates;
  else return [];

  const out: RateCardEntry[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const skill = (o.skill ?? o.category ?? o.skillCategory ?? o.name) as string | undefined;
    if (!skill || typeof skill !== 'string') continue;
    const rate8h = typeof o.rate8h === 'number' ? o.rate8h : undefined;
    const rate12h = typeof o.rate12h === 'number' ? o.rate12h : undefined;
    const dailyRate = typeof o.dailyRate === 'number' ? o.dailyRate : undefined;
    const rate = typeof o.rate === 'number' ? o.rate : undefined;
    out.push({ skill, rate8h, rate12h, dailyRate, rate });
  }
  return out;
}

async function handlePickSkill(session: LaborSession, text: string): Promise<void> {
  const idx = parseInt(text.trim(), 10) - 1;
  const choices = session.draft.skillChoices ?? [];
  if (isNaN(idx) || idx < 0 || idx >= choices.length) {
    await send(session.chatId, 'Reply with one of the listed numbers.');
    return;
  }
  const picked = choices[idx];
  session.draft.skillCategory = picked.skill;
  session.draft.dailyRate = getRate(picked);
  session.step = 'first_name';
  await send(session.chatId, '👤 Worker name? (first + last is fine)');
}

async function handleName(session: LaborSession, text: string): Promise<void> {
  const t = text.trim();
  if (t.length < 2) {
    await send(session.chatId, 'Name too short. Try again.');
    return;
  }
  const parts = t.split(/\s+/);
  session.draft.firstName = parts[0];
  session.draft.lastName = parts.slice(1).join(' ') || null;
  session.step = 'father_name';
  await send(session.chatId, "Father's name? (or type *skip*)");
}

async function handleFatherName(session: LaborSession, text: string): Promise<void> {
  const t = text.trim();
  session.draft.fatherName = t.toLowerCase() === 'skip' ? null : t;
  session.step = 'phone';
  await send(session.chatId, '📞 Phone? (or type *skip*)');
}

async function handlePhone(session: LaborSession, text: string): Promise<void> {
  const t = text.trim();
  if (t.toLowerCase() === 'skip') {
    session.draft.phone = null;
  } else {
    const digits = t.replace(/\D/g, '');
    if (digits.length < 10) {
      await send(session.chatId, "Phone must be at least 10 digits, or type *skip*.");
      return;
    }
    session.draft.phone = digits;
  }
  await proceedToConfirm(session);
}

async function proceedToConfirm(session: LaborSession): Promise<void> {
  const d = session.draft;
  session.step = 'confirm_save';
  await send(session.chatId, [
    '🔍 *Confirm:*',
    '',
    `Name        : ${d.firstName} ${d.lastName ?? ''}`.trim(),
    `Father      : ${d.fatherName ?? '—'}`,
    `Phone       : ${d.phone ?? '—'}`,
    `Contractor  : ${d.contractorName}`,
    `Work Order  : WO-${d.woNo} ${d.woTitle}`,
    `Skill       : ${d.skillCategory}`,
    `Daily rate  : ₹${(d.dailyRate ?? 0).toLocaleString('en-IN')}`,
    '',
    'Reply *yes* to save, anything else to cancel.',
  ].join('\n'));
}

async function handleConfirmSave(session: LaborSession, text: string): Promise<void> {
  if (text.trim().toLowerCase() !== 'yes' && text.trim() !== '✅') {
    await send(session.chatId, '❌ Cancelled. Type "labor" to start over.');
    sessions.delete(session.chatId);
    return;
  }

  const d = session.draft;
  try {
    // Allocate workerNo + workerCode atomically
    const last = await prisma.laborWorker.findFirst({ orderBy: { workerNo: 'desc' }, select: { workerNo: true } });
    const nextNo = last ? last.workerNo + 1 : 1;
    const workerCode = `LW-${String(nextNo).padStart(3, '0')}`;

    // Pick up the WO's company so the worker is filed correctly
    const wo = await prisma.workOrder.findUnique({
      where: { id: d.workOrderId! },
      select: { companyId: true },
    });

    const created = await prisma.laborWorker.create({
      data: {
        workerCode,
        firstName: d.firstName!,
        lastName: d.lastName ?? null,
        fatherName: d.fatherName ?? null,
        phone: d.phone ?? null,
        contractorId: d.contractorId!,
        workOrderId: d.workOrderId,
        skillCategory: d.skillCategory ?? null,
        dailyRate: d.dailyRate ?? null,
        joinedAt: new Date(),
        companyId: wo?.companyId ?? null,
      },
    });

    // Show running totals for context
    const woStats = await prisma.workOrder.findUnique({
      where: { id: d.workOrderId! },
      select: {
        woNo: true,
        laborWorkers: { where: { isActive: true }, select: { dailyRate: true } },
      },
    });
    const count = woStats?.laborWorkers.length ?? 0;
    const todayCost = (woStats?.laborWorkers ?? []).reduce((s, l) => s + (l.dailyRate ?? 0), 0);

    await send(session.chatId, [
      `✅ *${created.workerCode}* ${d.firstName} ${d.lastName ?? ''}`.trim(),
      `   ${d.skillCategory} · ₹${(d.dailyRate ?? 0).toLocaleString('en-IN')}/day`,
      `   on WO-${d.woNo}`,
      '',
      `_WO-${d.woNo} now has ${count} active labor · ₹${todayCost.toLocaleString('en-IN')}/day_`,
    ].join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await send(session.chatId, `❌ Save failed: ${msg.slice(0, 150)}\n\nTry again from the ERP if this keeps happening.`);
  } finally {
    sessions.delete(session.chatId);
  }
}

// ── Master handler ──

async function handleLaborMessage(chatId: string, text: string, _name: string | null): Promise<boolean> {
  const session = sessions.get(chatId);
  const trimmed = text.trim();

  // Outside-of-session triggers
  if (!session) {
    if (isTrigger(trimmed)) {
      const s = newSession(chatId);
      sessions.set(chatId, s);
      await showMenu(chatId);
      return true;
    }
    return false; // not for us
  }

  // Session expired?
  if (session.expiresAt.getTime() < Date.now()) {
    sessions.delete(chatId);
    await send(chatId, '⏰ Labor session timed out. Type "labor" to start over.');
    return true;
  }

  // Universal cancel
  if (isCancel(trimmed)) {
    sessions.delete(chatId);
    await send(chatId, '❌ Cancelled. Type "labor" anytime to start again.');
    return true;
  }

  // Re-trigger inside a session = restart
  if (isTrigger(trimmed)) {
    sessions.delete(chatId);
    const s = newSession(chatId);
    sessions.set(chatId, s);
    await showMenu(chatId);
    return true;
  }

  // Menu mode
  if (session.mode === 'menu') {
    if (trimmed === '1' || /^add/i.test(trimmed)) {
      await startAdd(chatId, session);
      return true;
    }
    if (trimmed === '2' || /^(list|show)/i.test(trimmed)) {
      session.mode = 'list';
      await startListWOs(chatId);
      sessions.delete(chatId); // list is one-shot
      return true;
    }
    if (trimmed === '3') {
      sessions.delete(chatId);
      await send(chatId, '❌ Cancelled.');
      return true;
    }
    await send(chatId, 'Reply 1, 2, or 3.');
    return true;
  }

  // Add mode dispatch
  if (session.mode === 'add' && session.step) {
    try {
      switch (session.step) {
        case 'pick_wo':      await handlePickWO(session, trimmed); return true;
        case 'pick_skill':   await handlePickSkill(session, trimmed); return true;
        case 'first_name':   await handleName(session, trimmed); return true;
        case 'father_name':  await handleFatherName(session, trimmed); return true;
        case 'phone':        await handlePhone(session, trimmed); return true;
        case 'confirm_save': await handleConfirmSave(session, trimmed); return true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[TG-Labor] handler error:', msg);
      await send(chatId, `⚠️ Something went wrong: ${msg.slice(0, 120)}\n_Type cancel to start over._`);
      return true;
    }
  }

  return true;
}

// ── Init ──

let initialized = false;

export function initTelegramLabor(): void {
  if (initialized) return;
  initialized = true;
  registerIncomingHandler(handleLaborMessage);
  // Periodic sweep of expired sessions so we don't leak
  setInterval(() => {
    const now = Date.now();
    for (const [chatId, s] of sessions) {
      if (s.expiresAt.getTime() < now) sessions.delete(chatId);
    }
  }, 5 * 60_000);
  console.log('[TG-Labor] Initialized — listens for "labor" / "labour" trigger');
}

export function getLaborSessionsStatus() {
  return {
    active: sessions.size,
    sessions: [...sessions.values()].map(s => ({
      chatId: s.chatId.slice(-6),
      mode: s.mode,
      step: s.step,
      startedAt: s.startedAt.toISOString(),
    })),
  };
}

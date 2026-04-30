/**
 * Telegram Image Handler — OCR/Vision via Gemini API
 *
 * When operators send photos to @EthanolERP_bot, this handler:
 * - Downloads the image from Telegram
 * - Sends to Gemini Vision API for analysis
 * - Returns extracted text (truck numbers, meter readings, etc.)
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { registerPhotoHandler, downloadTelegramFile, sendTelegramMessage } from './telegramBot';
import prisma from '../config/prisma';

const GEMINI_KEY = process.env.GEMINI_API_KEY;

async function analyzeImage(imageBuffer: Buffer, prompt: string): Promise<string | null> {
  if (!GEMINI_KEY) return null;

  try {
    const base64 = imageBuffer.toString('base64');
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          ],
        }],
      },
      { timeout: 30000 }
    );

    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || null;
  } catch (err: unknown) {
    console.error('[ImageHandler] Gemini API error:', ((err as Record<string, any>).response as Record<string, any>)?.data?.error?.message || (err instanceof Error ? err.message : String(err)));
    return null;
  }
}

/** Save a tagged photo (#iodine, etc.) to disk and link to the latest DB entry */
async function handleTaggedPhoto(chatId: string, fileId: string, tag: string): Promise<boolean> {
  const imageBuffer = await downloadTelegramFile(fileId);
  if (!imageBuffer) {
    await sendTelegramMessage(chatId, '❌ Could not download image.', 'image');
    return true;
  }

  if (tag === 'iodine') {
    // Save to uploads/iodine/
    const uploadsDir = path.join(__dirname, '../../uploads/iodine');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const filename = `tg_iodine_${Date.now()}.jpg`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, imageBuffer);

    const photoUrl = `/uploads/iodine/${filename}`;

    // Find latest liquefaction entry (today or most recent)
    const latest = await prisma.liquefactionEntry.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true, analysisTime: true },
    });

    if (latest) {
      await prisma.liquefactionEntry.update({
        where: { id: latest.id },
        data: { fltIodinePhotoUrl: photoUrl },
      });
      await sendTelegramMessage(chatId, `✅ Iodine test photo saved to latest liquefaction entry (${latest.analysisTime || 'recent'})`, 'image');
    } else {
      await sendTelegramMessage(chatId, `✅ Iodine photo saved as ${filename}. No liquefaction entry found to attach to — will be available when next entry is created.`, 'image');
    }

    // Also run Gemini analysis if available
    if (GEMINI_KEY) {
      const result = await analyzeImage(imageBuffer, 'This is an iodine test image from a distillery liquefaction process. Analyze the iodine test result: is it POSITIVE (blue/dark = starch present, incomplete conversion) or NEGATIVE (yellow/amber = no starch, good conversion)? Be brief.');
      if (result) {
        await sendTelegramMessage(chatId, `🔬 *Iodine Analysis:* ${result}`, 'image');
      }
    }
    return true;
  }

  return false; // tag not handled
}

async function handlePhoto(chatId: string, fileId: string, caption: string | null, _name: string | null): Promise<boolean> {
  // Check for tagged photos first (#iodine, #lab, etc.)
  if (caption) {
    const tagMatch = caption.match(/#(\w+)/);
    if (tagMatch) {
      const tag = tagMatch[1].toLowerCase();
      const handled = await handleTaggedPhoto(chatId, fileId, tag);
      if (handled) return true;
    }
  }

  // Download image from Telegram
  const imageBuffer = await downloadTelegramFile(fileId);
  if (!imageBuffer) {
    await sendTelegramMessage(chatId, '❌ Could not download image. Please try again.', 'image');
    return true;
  }

  // Determine analysis type from caption
  let prompt: string;
  if (caption && /truck|vehicle|number.*plate|plate/i.test(caption)) {
    prompt = 'Read the vehicle/truck number plate in this image. Return ONLY the number plate text (e.g. "MP 20 GA 1234"). If no plate is visible, say "No number plate found".';
  } else if (caption && /meter|reading|gauge|dial/i.test(caption)) {
    prompt = 'Read the meter/gauge/dial reading in this image. Return the numerical value shown. If multiple readings, list them. If unclear, describe what you see.';
  } else if (caption && /label|text|board|sign/i.test(caption)) {
    prompt = 'Extract all text visible in this image. Format it clearly.';
  } else {
    // Default: general analysis for plant/industrial context
    prompt = 'Analyze this image from a distillery/ethanol plant. Extract any useful information: equipment readings, meter values, truck/vehicle numbers, labels, text on boards/signs, gauge readings, or notable observations. Be concise and factual. If you see a number plate, read it. If you see meter readings, report them.';
  }

  await sendTelegramMessage(chatId, '🔍 Analyzing image...', 'image');

  const result = await analyzeImage(imageBuffer, prompt);

  if (result) {
    await sendTelegramMessage(chatId, `📷 *Image Analysis*\n\n${result}`, 'image');
  } else {
    await sendTelegramMessage(chatId, '❌ Could not analyze image. Make sure the image is clear and try again.', 'image');
  }

  return true;
}

export function initImageHandler(): void {
  registerPhotoHandler(handlePhoto);
  if (!GEMINI_KEY) {
    console.log('[ImageHandler] No GEMINI_API_KEY — image analysis disabled, tagged photo saving still works (#iodine)');
  } else {
    console.log('[ImageHandler] Telegram image handler enabled (Gemini Vision + tagged photo saving)');
  }
}

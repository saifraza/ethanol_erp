/**
 * Cloud ERP proxy — forwards requests from factory frontend to cloud API.
 * Factory frontend calls /api/cloud/ethanol-gate-pass → proxy to app.mspil.in/api/ethanol-gate-pass
 */
import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

router.all('/*', async (req: Request, res: Response) => {
  const cloudPath = req.originalUrl.replace('/api/cloud', '');
  const cloudUrl = `${config.cloudErpUrl}${cloudPath}`;

  try {
    const headers: Record<string, string> = {
      'X-WB-Key': config.cloudApiKey,
    };
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    };
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const response = await fetch(cloudUrl, fetchOpts);
    const contentType = response.headers.get('content-type') || '';

    // Binary responses (PDF, images)
    if (contentType.includes('application/pdf') || contentType.includes('text/html') || contentType.includes('image/')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      const disposition = response.headers.get('content-disposition');
      if (disposition) res.setHeader('Content-Disposition', disposition);
      res.status(response.status).send(buffer);
    } else {
      // Safe JSON parse — don't crash on non-JSON responses
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        res.status(response.status).json(data);
      } catch {
        res.status(response.status).type('text').send(text);
      }
    }
  } catch (err: any) {
    console.error(`[CLOUD PROXY] ${req.method} ${cloudUrl} failed:`, err.message);
    res.status(502).json({ error: 'Cloud ERP unreachable', detail: err.message });
  }
});

export default router;

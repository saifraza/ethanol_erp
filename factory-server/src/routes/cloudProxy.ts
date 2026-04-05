/**
 * Cloud ERP proxy — forwards requests from factory frontend to cloud API.
 * Used for features where business logic lives on cloud (ethanol gate pass, contracts).
 * Factory frontend calls /api/cloud/ethanol-gate-pass → proxy to app.mspil.in/api/ethanol-gate-pass
 */
import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

// Proxy all requests under /api/cloud/* to cloud ERP
router.all('/*', async (req: Request, res: Response) => {
  const cloudPath = req.originalUrl.replace('/api/cloud', '');
  const cloudUrl = `${config.cloudErpUrl}${cloudPath}`;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-WB-Key': config.cloudApiKey,
    };
    // Forward auth token if present
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }

    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    };
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const response = await fetch(cloudUrl, fetchOpts);

    // Forward content-type for PDFs
    const contentType = response.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', contentType);

    if (contentType.includes('application/pdf') || contentType.includes('text/html')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const disposition = response.headers.get('content-disposition');
      if (disposition) res.setHeader('Content-Disposition', disposition);
      res.status(response.status).send(buffer);
    } else {
      const data = await response.json();
      res.status(response.status).json(data);
    }
  } catch (err: any) {
    console.error(`[CLOUD PROXY] ${req.method} ${cloudUrl} failed:`, err.message);
    res.status(502).json({ error: 'Cloud ERP unreachable', detail: err.message });
  }
});

export default router;

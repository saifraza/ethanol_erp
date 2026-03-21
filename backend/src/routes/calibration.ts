import { Router, Request, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import calibrationData from '../data/calibrations.json';

const router = Router();
router.use(authenticate as any);

console.log(`Calibration data loaded: ${Object.keys(calibrationData).length} tanks`);

// GET /api/calibration — returns all calibration data
router.get('/', (req: Request, res: Response) => {
  res.json(calibrationData);
});

// GET /api/calibration/:tank/:dip — lookup single value
// dip is in cm with decimal, e.g. 45.7
router.get('/:tank/:dip', (req: Request, res: Response) => {
  const { tank, dip } = req.params;
  const tankData = (calibrationData as any)[tank];
  if (!tankData) {
    res.status(404).json({ error: `Tank ${tank} not found` });
    return;
  }
  const dipFloat = parseFloat(dip);
  if (isNaN(dipFloat)) {
    res.status(400).json({ error: 'Invalid DIP value' });
    return;
  }
  // Convert to key: e.g. 45.7 -> 457
  const key = String(Math.round(dipFloat * 10));
  const volume = tankData[key];
  if (volume === undefined) {
    res.status(404).json({ error: `DIP ${dip} out of range for ${tank}` });
    return;
  }
  res.json({ tank, dip: dipFloat, volume, unit: 'litres' });
});

export default router;

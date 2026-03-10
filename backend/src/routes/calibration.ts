import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// Load calibration data once at startup
let calibrationData: Record<string, Record<string, number>> = {};
try {
  const dataPath = path.join(__dirname, '..', 'data', 'calibrations.json');
  calibrationData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`Calibration data loaded: ${Object.keys(calibrationData).length} tanks`);
} catch (err) {
  console.error('Failed to load calibration data:', err);
}

// GET /api/calibration — returns all calibration data
router.get('/', (req: Request, res: Response) => {
  res.json(calibrationData);
});

// GET /api/calibration/:tank/:dip — lookup single value
// dip is in cm with decimal, e.g. 45.7
router.get('/:tank/:dip', (req: Request, res: Response) => {
  const { tank, dip } = req.params;
  const tankData = calibrationData[tank];
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

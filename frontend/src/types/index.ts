export interface User {
  id: string; email: string; name: string; role: 'OPERATOR' | 'SUPERVISOR' | 'ADMIN'; isActive?: boolean;
}

export interface DailyEntry {
  id: string; date: string; status: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
  grainOpeningStock?: number; grainUnloadedToday?: number; grainClosingStock?: number; grainPercent: number;
  fltFlow?: number; washFlow?: number; spentWashFlow?: number; thinSlopFlow?: number; thinSlopRecycleFlow?: number;
  syrup1Flow?: number; syrup2Flow?: number; syrup3Flow?: number; totalSyrupFlow?: number;
  slurryMade?: number; washMade?: number; grainConsumed?: number; grainDistilled?: number;
  starchPercent?: number; grainInFermenter?: number; grainFlowBalance?: number;
  fermenter1Level?: number; fermenter1Volume?: number; fermenter2Level?: number; fermenter2Volume?: number;
  fermenter3Level?: number; fermenter3Volume?: number; fermenter4Level?: number; fermenter4Volume?: number;
  beerWellLevel?: number; beerWellVolume?: number; pfLevel?: number; pfVolume?: number;
  totalFermenterVolume?: number; grainInFermenters?: number;
  beerWellAlcoholConc?: number; recovery?: number; distillationEfficiency?: number; overallEfficiency?: number;
  steam1?: number; steam2?: number; steam3?: number; steam4?: number; steam5?: number;
  steamTotal?: number; steamRate?: number; steamAvgTPH?: number; steamPerTonGrain?: number;
  ddgsBags?: number; ddgsWeight?: number; ddgsProduction?: number;
  productionBL?: number; avgStrength?: number; productionAL?: number;
  ethanolOpeningStock?: number; ethanolDispatch?: number; ethanolClosingStock?: number;
  remarks?: string; userId: string; user?: { name: string; email: string };
}

export interface SystemSettings {
  grainPercent: number; fermenter1Cap: number; fermenter2Cap: number; fermenter3Cap: number; fermenter4Cap: number;
  beerWellCap: number; pfCap: number; rsTankCap: number; hfoTankCap: number; lfoTankCap: number; pfGrainPercent: number;
}

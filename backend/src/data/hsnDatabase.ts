/**
 * Curated HSN Code database for distillery, chemical, and industrial items.
 * Used for smart item lookup when adding inventory items.
 * Source: CBIC HSN classification, common distillery industry items.
 */

export interface HSNItem {
  name: string;
  hsn: string;
  gst: number;         // GST percent
  category: string;    // Maps to InventoryItem.category
  unit: string;        // Default unit
  keywords: string[];  // For fuzzy search
}

export const hsnDatabase: HSNItem[] = [
  // ─── RAW MATERIALS — Grains & Feedstock ───
  { name: 'Broken Rice', hsn: '1006', gst: 5, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['rice', 'broken rice', 'chawal', 'grain'] },
  { name: 'Maize / Corn', hsn: '1005', gst: 5, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['maize', 'corn', 'makka', 'grain'] },
  { name: 'Wheat', hsn: '1001', gst: 5, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['wheat', 'gehun', 'grain'] },
  { name: 'Sorghum / Jowar', hsn: '1007', gst: 5, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['sorghum', 'jowar', 'grain', 'milo'] },
  { name: 'Bajra / Pearl Millet', hsn: '1008', gst: 5, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['bajra', 'pearl millet', 'grain'] },
  { name: 'Ragi / Finger Millet', hsn: '1008', gst: 5, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['ragi', 'finger millet', 'grain'] },
  { name: 'Molasses', hsn: '1703', gst: 28, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['molasses', 'sheera', 'sugarcane molasses', 'black strap'] },
  { name: 'Sugarcane Juice', hsn: '1212', gst: 5, category: 'RAW_MATERIAL', unit: 'LTR', keywords: ['sugarcane', 'juice', 'cane juice', 'ganne ka ras'] },

  // ─── CHEMICALS — Enzymes ───
  { name: 'Alpha Amylase Enzyme', hsn: '3507', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['alpha amylase', 'enzyme', 'liquefaction enzyme', 'amylase'] },
  { name: 'Gluco Amylase Enzyme', hsn: '3507', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['gluco amylase', 'glucoamylase', 'saccharification enzyme', 'AMG'] },
  { name: 'Protease Enzyme', hsn: '3507', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['protease', 'enzyme', 'protein enzyme'] },
  { name: 'Cellulase Enzyme', hsn: '3507', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['cellulase', 'enzyme', 'cellulose enzyme'] },
  { name: 'Xylanase Enzyme', hsn: '3507', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['xylanase', 'enzyme', 'hemicellulose'] },
  { name: 'Pectinase Enzyme', hsn: '3507', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['pectinase', 'enzyme', 'pectin'] },

  // ─── CHEMICALS — Yeast & Fermentation ───
  { name: 'Distillery Yeast (Dry)', hsn: '2102', gst: 12, category: 'CHEMICAL', unit: 'KG', keywords: ['yeast', 'dry yeast', 'distillery yeast', 'saccharomyces', 'active dry yeast'] },
  { name: 'Fresh Yeast', hsn: '2102', gst: 12, category: 'CHEMICAL', unit: 'KG', keywords: ['fresh yeast', 'compressed yeast', 'live yeast'] },
  { name: 'Yeast Nutrient', hsn: '2102', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['yeast nutrient', 'DAP', 'diammonium phosphate', 'nutrient'] },
  { name: 'Urea (Technical Grade)', hsn: '3102', gst: 5, category: 'CHEMICAL', unit: 'KG', keywords: ['urea', 'technical urea', 'nitrogen source'] },
  { name: 'Antifoam / Defoamer', hsn: '3824', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['antifoam', 'defoamer', 'silicone antifoam', 'foam control'] },
  { name: 'Antibacterial / Antibiotic', hsn: '2941', gst: 12, category: 'CHEMICAL', unit: 'KG', keywords: ['antibiotic', 'antibacterial', 'virginiamycin', 'penicillin', 'infection control'] },

  // ─── CHEMICALS — Acids & Bases ───
  { name: 'Sulphuric Acid (H2SO4)', hsn: '2807', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['sulphuric acid', 'sulfuric acid', 'h2so4', 'acid'] },
  { name: 'Hydrochloric Acid (HCl)', hsn: '2806', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['hydrochloric acid', 'hcl', 'muriatic acid'] },
  { name: 'Phosphoric Acid', hsn: '2809', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['phosphoric acid', 'h3po4'] },
  { name: 'Caustic Soda / NaOH', hsn: '2815', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['caustic soda', 'naoh', 'sodium hydroxide', 'lye'] },
  { name: 'Soda Ash / Na2CO3', hsn: '2836', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['soda ash', 'na2co3', 'sodium carbonate', 'washing soda'] },
  { name: 'Citric Acid', hsn: '2918', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['citric acid', 'nimbu acid'] },
  { name: 'Acetic Acid', hsn: '2915', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['acetic acid', 'vinegar acid', 'ch3cooh'] },
  { name: 'Nitric Acid', hsn: '2808', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['nitric acid', 'hno3'] },
  { name: 'Lime / Calcium Oxide', hsn: '2522', gst: 5, category: 'CHEMICAL', unit: 'KG', keywords: ['lime', 'quicklime', 'calcium oxide', 'cao', 'chuna'] },
  { name: 'Hydrated Lime / Ca(OH)2', hsn: '2522', gst: 5, category: 'CHEMICAL', unit: 'KG', keywords: ['hydrated lime', 'slaked lime', 'calcium hydroxide'] },

  // ─── CHEMICALS — Water Treatment ───
  { name: 'Sodium Hypochlorite', hsn: '2828', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['sodium hypochlorite', 'bleach', 'chlorine', 'disinfectant'] },
  { name: 'Alum / Aluminium Sulphate', hsn: '2833', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['alum', 'aluminium sulphate', 'water treatment', 'flocculant'] },
  { name: 'Poly Aluminium Chloride (PAC)', hsn: '2827', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['pac', 'poly aluminium chloride', 'water treatment', 'coagulant'] },
  { name: 'Sodium Metabisulphite', hsn: '2832', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['smbs', 'sodium metabisulphite', 'antioxidant', 'preservative'] },
  { name: 'Activated Carbon', hsn: '3802', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['activated carbon', 'charcoal', 'carbon filter', 'GAC'] },
  { name: 'Ion Exchange Resin', hsn: '3914', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['ion exchange', 'resin', 'cation resin', 'anion resin', 'DM plant'] },
  { name: 'RO Antiscalant', hsn: '3824', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['antiscalant', 'ro chemical', 'reverse osmosis', 'scale inhibitor'] },
  { name: 'RO Membrane Cleaner', hsn: '3402', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['membrane cleaner', 'ro cleaner', 'membrane cleaning'] },

  // ─── CHEMICALS — Cleaning & CIP ───
  { name: 'CIP Acid Cleaner', hsn: '3402', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['cip', 'acid cleaner', 'clean in place', 'cleaning'] },
  { name: 'CIP Alkali Cleaner', hsn: '3402', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['cip', 'alkali cleaner', 'caustic cleaner', 'cleaning'] },
  { name: 'Descaling Chemical', hsn: '3824', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['descaling', 'descaler', 'scale remover', 'boiler chemical'] },
  { name: 'Boiler Treatment Chemical', hsn: '3824', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['boiler chemical', 'boiler treatment', 'oxygen scavenger', 'corrosion inhibitor'] },
  { name: 'Cooling Tower Chemical', hsn: '3824', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['cooling tower', 'ct chemical', 'biocide', 'algaecide'] },

  // ─── CHEMICALS — Lab & Testing ───
  { name: 'Potassium Dichromate', hsn: '2841', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['potassium dichromate', 'k2cr2o7', 'lab chemical', 'titration'] },
  { name: 'Sodium Thiosulphate', hsn: '2832', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['sodium thiosulphate', 'hypo', 'lab chemical'] },
  { name: 'Iodine Solution', hsn: '2801', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['iodine', 'iodine solution', 'lab reagent'] },
  { name: 'Phenolphthalein Indicator', hsn: '3822', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['phenolphthalein', 'indicator', 'lab reagent', 'pp indicator'] },
  { name: 'Methyl Orange Indicator', hsn: '3204', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['methyl orange', 'indicator', 'lab reagent'] },
  { name: 'pH Buffer Solution', hsn: '3822', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['ph buffer', 'buffer solution', 'calibration', 'lab'] },
  { name: 'Ethanol Standard (Reference)', hsn: '2207', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['ethanol standard', 'reference standard', 'calibration'] },
  { name: 'Benedict\'s Reagent', hsn: '3822', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['benedicts', 'reagent', 'sugar test', 'lab'] },
  { name: 'Fehling\'s Solution', hsn: '3822', gst: 18, category: 'CHEMICAL', unit: 'LTR', keywords: ['fehlings', 'solution', 'sugar test', 'lab'] },

  // ─── FINISHED GOODS ───
  { name: 'Ethanol (ENA)', hsn: '2207', gst: 18, category: 'FINISHED_GOOD', unit: 'LTR', keywords: ['ethanol', 'ena', 'extra neutral alcohol', 'spirit'] },
  { name: 'Rectified Spirit (RS)', hsn: '2207', gst: 18, category: 'FINISHED_GOOD', unit: 'LTR', keywords: ['rectified spirit', 'rs', 'alcohol'] },
  { name: 'Fuel Ethanol (E100)', hsn: '2207', gst: 5, category: 'FINISHED_GOOD', unit: 'LTR', keywords: ['fuel ethanol', 'e100', 'anhydrous ethanol', 'denatured'] },
  { name: 'Denatured Spirit', hsn: '2207', gst: 18, category: 'FINISHED_GOOD', unit: 'LTR', keywords: ['denatured spirit', 'methylated spirit', 'SDS'] },
  { name: 'DDGS (Dried Distillers Grain)', hsn: '2303', gst: 5, category: 'FINISHED_GOOD', unit: 'MT', keywords: ['ddgs', 'distillers grain', 'animal feed', 'cattle feed'] },
  { name: 'WDGS (Wet Distillers Grain)', hsn: '2303', gst: 5, category: 'FINISHED_GOOD', unit: 'MT', keywords: ['wdgs', 'wet grain', 'wet distillers grain'] },
  { name: 'Fusel Oil', hsn: '2207', gst: 18, category: 'FINISHED_GOOD', unit: 'LTR', keywords: ['fusel oil', 'fusel', 'byproduct'] },
  { name: 'CO2 (Carbon Dioxide)', hsn: '2811', gst: 18, category: 'FINISHED_GOOD', unit: 'MT', keywords: ['co2', 'carbon dioxide', 'dry ice', 'food grade co2'] },
  { name: 'Spent Wash (Vinasse)', hsn: '2303', gst: 5, category: 'RAW_MATERIAL', unit: 'KL', keywords: ['spent wash', 'vinasse', 'effluent', 'stillage'] },

  // ─── SPARE PARTS — Pumps & Valves ───
  { name: 'Centrifugal Pump', hsn: '8413', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['pump', 'centrifugal pump', 'water pump', 'transfer pump'] },
  { name: 'Pump Mechanical Seal', hsn: '8484', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['mechanical seal', 'pump seal', 'seal', 'shaft seal'] },
  { name: 'Pump Impeller', hsn: '8413', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['impeller', 'pump impeller', 'pump spare'] },
  { name: 'Ball Valve', hsn: '8481', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['ball valve', 'valve', 'shut off valve'] },
  { name: 'Gate Valve', hsn: '8481', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['gate valve', 'valve', 'sluice valve'] },
  { name: 'Butterfly Valve', hsn: '8481', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['butterfly valve', 'valve', 'wafer valve'] },
  { name: 'Globe Valve', hsn: '8481', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['globe valve', 'valve', 'control valve'] },
  { name: 'Check Valve / NRV', hsn: '8481', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['check valve', 'nrv', 'non return valve'] },
  { name: 'Safety / Relief Valve', hsn: '8481', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['safety valve', 'relief valve', 'pressure relief', 'PRV'] },
  { name: 'Solenoid Valve', hsn: '8481', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['solenoid valve', 'electric valve', 'pneumatic valve'] },
  { name: 'Control Valve (Pneumatic)', hsn: '8481', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['control valve', 'pneumatic valve', 'actuator valve'] },
  { name: 'Steam Trap', hsn: '8481', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['steam trap', 'condensate trap', 'thermodynamic trap'] },

  // ─── SPARE PARTS — Bearings & Seals ───
  { name: 'Ball Bearing', hsn: '8482', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['ball bearing', 'bearing', 'SKF', 'FAG', 'roller bearing'] },
  { name: 'Roller Bearing', hsn: '8482', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['roller bearing', 'taper roller', 'bearing'] },
  { name: 'Pillow Block Bearing', hsn: '8482', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['pillow block', 'plummer block', 'bearing housing', 'UCP'] },
  { name: 'Oil Seal', hsn: '4016', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['oil seal', 'shaft seal', 'rubber seal', 'lip seal'] },
  { name: 'O-Ring', hsn: '4016', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['o-ring', 'oring', 'gasket ring', 'rubber ring'] },
  { name: 'Gasket (Rubber/PTFE)', hsn: '4016', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['gasket', 'rubber gasket', 'ptfe gasket', 'flange gasket'] },
  { name: 'Gasket Sheet', hsn: '6812', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['gasket sheet', 'jointing sheet', 'CAF gasket'] },
  { name: 'V-Belt', hsn: '4010', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['v-belt', 'belt', 'drive belt', 'fan belt'] },
  { name: 'Coupling (Flexible)', hsn: '8483', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['coupling', 'flexible coupling', 'jaw coupling', 'gear coupling'] },

  // ─── SPARE PARTS — Electrical ───
  { name: 'Electric Motor', hsn: '8501', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['motor', 'electric motor', 'induction motor', '3 phase motor'] },
  { name: 'VFD / Variable Frequency Drive', hsn: '8504', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['vfd', 'variable frequency drive', 'inverter', 'ac drive'] },
  { name: 'Contactor', hsn: '8536', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['contactor', 'magnetic contactor', 'power contactor'] },
  { name: 'Overload Relay', hsn: '8536', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['overload relay', 'thermal overload', 'OLR', 'motor protection'] },
  { name: 'MCB / Circuit Breaker', hsn: '8536', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['mcb', 'circuit breaker', 'mccb', 'breaker'] },
  { name: 'Control Cable', hsn: '8544', gst: 18, category: 'SPARE_PART', unit: 'MTR', keywords: ['control cable', 'cable', 'signal cable', 'instrument cable'] },
  { name: 'Power Cable', hsn: '8544', gst: 18, category: 'SPARE_PART', unit: 'MTR', keywords: ['power cable', 'cable', 'armoured cable', 'XLPE cable'] },
  { name: 'Thermocouple / RTD', hsn: '9025', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['thermocouple', 'rtd', 'temperature sensor', 'pt100', 'type K'] },
  { name: 'Pressure Transmitter', hsn: '9026', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['pressure transmitter', 'pressure sensor', 'PT', 'pressure gauge'] },
  { name: 'Level Transmitter', hsn: '9026', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['level transmitter', 'level sensor', 'ultrasonic level', 'radar level'] },
  { name: 'Flow Meter', hsn: '9028', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['flow meter', 'magnetic flow meter', 'coriolis', 'rotameter'] },
  { name: 'pH Meter / Probe', hsn: '9027', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['ph meter', 'ph probe', 'ph sensor', 'ph electrode'] },
  { name: 'Temperature Controller', hsn: '9032', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['temperature controller', 'PID controller', 'temp controller'] },
  { name: 'PLC Module', hsn: '8537', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['plc', 'programmable logic controller', 'io module', 'PLC module'] },

  // ─── SPARE PARTS — Pipes & Fittings ───
  { name: 'SS Pipe (304/316)', hsn: '7306', gst: 18, category: 'SPARE_PART', unit: 'MTR', keywords: ['ss pipe', 'stainless pipe', '304 pipe', '316 pipe', 'seamless pipe'] },
  { name: 'MS Pipe', hsn: '7306', gst: 18, category: 'SPARE_PART', unit: 'MTR', keywords: ['ms pipe', 'mild steel pipe', 'carbon steel pipe', 'ERW pipe'] },
  { name: 'SS Elbow', hsn: '7307', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['elbow', 'ss elbow', 'pipe fitting', 'bend'] },
  { name: 'SS Tee', hsn: '7307', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['tee', 'ss tee', 'pipe fitting', 'equal tee'] },
  { name: 'SS Reducer', hsn: '7307', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['reducer', 'concentric reducer', 'eccentric reducer', 'pipe fitting'] },
  { name: 'Flange (SS/MS)', hsn: '7307', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['flange', 'blind flange', 'weld neck flange', 'slip on flange'] },
  { name: 'Nut & Bolt Set', hsn: '7318', gst: 18, category: 'SPARE_PART', unit: 'SET', keywords: ['nut bolt', 'fastener', 'hex bolt', 'stud bolt', 'bolt'] },
  { name: 'SS Clamp (Tri-Clover)', hsn: '7307', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['clamp', 'tri clamp', 'tc clamp', 'tri-clover', 'sanitary clamp'] },

  // ─── SPARE PARTS — Heat Exchange & Distillation ───
  { name: 'Heat Exchanger Plate', hsn: '8404', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['heat exchanger', 'plate', 'PHE plate', 'plate heat exchanger'] },
  { name: 'Heat Exchanger Gasket', hsn: '4016', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['heat exchanger gasket', 'PHE gasket', 'plate gasket'] },
  { name: 'Condenser Tube', hsn: '7306', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['condenser tube', 'tube bundle', 'shell tube'] },
  { name: 'Column Packing (Structured)', hsn: '7326', gst: 18, category: 'SPARE_PART', unit: 'KG', keywords: ['column packing', 'structured packing', 'distillation packing', 'mellapak'] },
  { name: 'Sieve Tray / Bubble Cap Tray', hsn: '7326', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['sieve tray', 'bubble cap', 'distillation tray', 'column tray'] },
  { name: 'Molecular Sieve (3A)', hsn: '3824', gst: 18, category: 'CHEMICAL', unit: 'KG', keywords: ['molecular sieve', '3a sieve', 'dehydration', 'zeolite', 'PSA'] },
  { name: 'Decanter Scroll', hsn: '8421', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['decanter scroll', 'centrifuge scroll', 'screw conveyor'] },
  { name: 'Decanter Bowl', hsn: '8421', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['decanter bowl', 'centrifuge bowl', 'decanter drum'] },

  // ─── CONSUMABLES — Packaging ───
  { name: 'HDPE Drum (200L)', hsn: '3923', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['hdpe drum', 'plastic drum', 'barrel', '200 litre drum'] },
  { name: 'MS Drum (200L)', hsn: '7310', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['ms drum', 'steel drum', 'metal barrel', '200 litre'] },
  { name: 'IBC Tank (1000L)', hsn: '3923', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['ibc', 'ibc tank', 'intermediate bulk container', '1000 litre'] },
  { name: 'PP Bag (50 kg)', hsn: '6305', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['pp bag', 'polypropylene bag', 'woven bag', 'grain bag', 'DDGS bag'] },
  { name: 'HDPE Bag', hsn: '3923', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['hdpe bag', 'plastic bag', 'liner bag'] },
  { name: 'Packing Tape', hsn: '3919', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['packing tape', 'bopp tape', 'adhesive tape', 'sealing tape'] },
  { name: 'Stretch Wrap Film', hsn: '3920', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['stretch wrap', 'shrink wrap', 'pallet wrap', 'cling film'] },

  // ─── CONSUMABLES — Safety & PPE ───
  { name: 'Safety Helmet', hsn: '6506', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['helmet', 'safety helmet', 'hard hat', 'head protection'] },
  { name: 'Safety Goggles', hsn: '9004', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['goggles', 'safety goggles', 'eye protection', 'safety glasses'] },
  { name: 'Safety Shoes', hsn: '6402', gst: 18, category: 'CONSUMABLE', unit: 'PAIR', keywords: ['safety shoes', 'safety boots', 'steel toe', 'gumboot'] },
  { name: 'Hand Gloves (Rubber)', hsn: '4015', gst: 18, category: 'CONSUMABLE', unit: 'PAIR', keywords: ['gloves', 'rubber gloves', 'hand gloves', 'nitrile gloves', 'chemical gloves'] },
  { name: 'Hand Gloves (Leather)', hsn: '4203', gst: 18, category: 'CONSUMABLE', unit: 'PAIR', keywords: ['leather gloves', 'welding gloves', 'heat resistant gloves'] },
  { name: 'Dust Mask / Respirator', hsn: '6307', gst: 12, category: 'CONSUMABLE', unit: 'NOS', keywords: ['mask', 'dust mask', 'respirator', 'N95', 'face mask'] },
  { name: 'Ear Plug / Muff', hsn: '9021', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['ear plug', 'ear muff', 'hearing protection', 'noise protection'] },
  { name: 'Safety Harness', hsn: '6307', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['safety harness', 'full body harness', 'fall protection'] },
  { name: 'Fire Extinguisher', hsn: '8424', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['fire extinguisher', 'ABC extinguisher', 'CO2 extinguisher', 'fire safety'] },

  // ─── CONSUMABLES — Lubricants & Maintenance ───
  { name: 'Lubricating Oil', hsn: '2710', gst: 18, category: 'CONSUMABLE', unit: 'LTR', keywords: ['lubricant', 'lubricating oil', 'machine oil', 'gear oil'] },
  { name: 'Grease (Bearing/General)', hsn: '2710', gst: 18, category: 'CONSUMABLE', unit: 'KG', keywords: ['grease', 'bearing grease', 'lithium grease', 'EP grease'] },
  { name: 'Hydraulic Oil', hsn: '2710', gst: 18, category: 'CONSUMABLE', unit: 'LTR', keywords: ['hydraulic oil', 'hydraulic fluid', 'HLP oil'] },
  { name: 'Transformer Oil', hsn: '2710', gst: 18, category: 'CONSUMABLE', unit: 'LTR', keywords: ['transformer oil', 'insulating oil', 'dielectric oil'] },
  { name: 'Cutting Oil', hsn: '2710', gst: 18, category: 'CONSUMABLE', unit: 'LTR', keywords: ['cutting oil', 'coolant', 'machining oil', 'soluble oil'] },
  { name: 'Welding Rod / Electrode', hsn: '8311', gst: 18, category: 'CONSUMABLE', unit: 'KG', keywords: ['welding rod', 'electrode', 'welding electrode', 'E6013', 'E7018'] },
  { name: 'Grinding Disc / Cut-off Wheel', hsn: '6804', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['grinding disc', 'cutting disc', 'cut off wheel', 'abrasive disc'] },
  { name: 'Emery Paper / Sandpaper', hsn: '6805', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['emery paper', 'sandpaper', 'abrasive paper'] },
  { name: 'PTFE Tape (Thread Seal)', hsn: '3920', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['ptfe tape', 'teflon tape', 'thread seal', 'plumber tape'] },

  // ─── CONSUMABLES — Lab ───
  { name: 'pH Paper / Strip', hsn: '3822', gst: 18, category: 'CONSUMABLE', unit: 'PKT', keywords: ['ph paper', 'ph strip', 'litmus paper', 'test strip'] },
  { name: 'Hydrometer', hsn: '9025', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['hydrometer', 'alcohol meter', 'density meter', 'brix meter'] },
  { name: 'Thermometer (Lab)', hsn: '9025', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['thermometer', 'mercury thermometer', 'digital thermometer', 'lab thermometer'] },
  { name: 'Beaker / Flask (Glass)', hsn: '7017', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['beaker', 'flask', 'conical flask', 'erlenmeyer', 'lab glassware'] },
  { name: 'Burette', hsn: '7017', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['burette', 'titration', 'lab glassware'] },
  { name: 'Pipette', hsn: '7017', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['pipette', 'volumetric pipette', 'lab glassware'] },
  { name: 'Filter Paper', hsn: '4812', gst: 18, category: 'CONSUMABLE', unit: 'PKT', keywords: ['filter paper', 'whatman', 'lab filter', 'filtration'] },
  { name: 'Sample Bottle', hsn: '7010', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['sample bottle', 'sample jar', 'reagent bottle', 'lab bottle'] },

  // ─── SPARE PARTS — Filtration ───
  { name: 'Filter Cartridge', hsn: '8421', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['filter cartridge', 'cartridge filter', 'sediment filter', 'micro filter'] },
  { name: 'Filter Bag', hsn: '5911', gst: 12, category: 'CONSUMABLE', unit: 'NOS', keywords: ['filter bag', 'bag filter', 'dust collector bag', 'pulse jet bag'] },
  { name: 'Filter Press Cloth', hsn: '5911', gst: 12, category: 'CONSUMABLE', unit: 'NOS', keywords: ['filter press cloth', 'filter cloth', 'press plate cloth'] },
  { name: 'RO Membrane', hsn: '8421', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['ro membrane', 'reverse osmosis membrane', 'membrane element'] },

  // ─── SPARE PARTS — Miscellaneous ───
  { name: 'Conveyor Belt', hsn: '4010', gst: 18, category: 'SPARE_PART', unit: 'MTR', keywords: ['conveyor belt', 'belt conveyor', 'rubber belt'] },
  { name: 'Chain Sprocket', hsn: '7315', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['sprocket', 'chain sprocket', 'roller chain', 'chain'] },
  { name: 'Gearbox', hsn: '8483', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['gearbox', 'gear box', 'reduction gear', 'worm gear'] },
  { name: 'Agitator / Stirrer', hsn: '8479', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['agitator', 'stirrer', 'mixer', 'tank agitator'] },
  { name: 'Sight Glass', hsn: '7020', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['sight glass', 'inspection glass', 'viewing glass'] },
  { name: 'Pressure Gauge', hsn: '9026', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['pressure gauge', 'bourdon gauge', 'manometer'] },
  { name: 'Temperature Gauge', hsn: '9025', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['temperature gauge', 'thermometer', 'dial thermometer', 'bimetal gauge'] },

  // ─── CONSUMABLES — Stationery & Office ───
  { name: 'Printer Paper (A4)', hsn: '4802', gst: 18, category: 'CONSUMABLE', unit: 'PKT', keywords: ['printer paper', 'a4 paper', 'copier paper', 'stationery'] },
  { name: 'Ink / Toner Cartridge', hsn: '3215', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['ink cartridge', 'toner', 'printer ink', 'refill'] },
  { name: 'Register / Logbook', hsn: '4820', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['register', 'logbook', 'record book', 'notebook'] },
  { name: 'Label / Sticker', hsn: '4821', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['label', 'sticker', 'barcode label', 'product label'] },

  // ─── UTILITIES & FUEL ───
  { name: 'Diesel / HSD', hsn: '2710', gst: 18, category: 'CONSUMABLE', unit: 'LTR', keywords: ['diesel', 'hsd', 'high speed diesel', 'fuel'] },
  { name: 'LPG Gas', hsn: '2711', gst: 5, category: 'CONSUMABLE', unit: 'KG', keywords: ['lpg', 'gas', 'liquefied petroleum gas', 'cooking gas'] },
  { name: 'Coal', hsn: '2701', gst: 5, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['coal', 'steam coal', 'boiler fuel'] },
  { name: 'Biomass / Rice Husk', hsn: '4401', gst: 5, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['biomass', 'rice husk', 'bagasse', 'boiler fuel', 'husk'] },
  { name: 'Wood / Firewood', hsn: '4401', gst: 5, category: 'RAW_MATERIAL', unit: 'MT', keywords: ['wood', 'firewood', 'logs', 'boiler fuel'] },

  // ─── SPARE PARTS — IT & Electronics ───
  { name: 'UPS Battery', hsn: '8507', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['ups battery', 'battery', 'SMF battery', 'inverter battery'] },
  { name: 'CCTV Camera', hsn: '8525', gst: 18, category: 'SPARE_PART', unit: 'NOS', keywords: ['cctv', 'camera', 'security camera', 'surveillance'] },
  { name: 'Network Cable (LAN)', hsn: '8544', gst: 18, category: 'CONSUMABLE', unit: 'MTR', keywords: ['lan cable', 'network cable', 'cat6', 'ethernet cable'] },
  { name: 'LED Light / Tube', hsn: '9405', gst: 18, category: 'CONSUMABLE', unit: 'NOS', keywords: ['led light', 'tube light', 'led tube', 'lighting'] },
];

/**
 * Simple fuzzy search: tokenize query, match against name + keywords.
 * Returns items sorted by relevance score (higher = better match).
 */
export function searchHSN(query: string, limit = 20): (HSNItem & { score: number })[] {
  if (!query || query.trim().length < 2) return [];

  const tokens = query.toLowerCase().split(/[\s,\/\-]+/).filter(t => t.length >= 2);
  if (tokens.length === 0) return [];

  const results = hsnDatabase.map((item) => {
    const searchText = [item.name, item.hsn, ...item.keywords].join(' ').toLowerCase();
    let score = 0;

    for (const token of tokens) {
      // Exact keyword match = 10 points
      if (item.keywords.some(k => k.toLowerCase() === token)) {
        score += 10;
      }
      // Name contains token = 8 points
      else if (item.name.toLowerCase().includes(token)) {
        score += 8;
      }
      // Keyword contains token = 5 points
      else if (item.keywords.some(k => k.toLowerCase().includes(token))) {
        score += 5;
      }
      // HSN starts with token = 7 points
      else if (item.hsn.startsWith(token)) {
        score += 7;
      }
      // Any field contains token = 2 points
      else if (searchText.includes(token)) {
        score += 2;
      }
    }

    // Bonus for matching all tokens
    const matchedTokens = tokens.filter(t => searchText.includes(t)).length;
    if (matchedTokens === tokens.length && tokens.length > 1) {
      score += 5;
    }

    return { ...item, score };
  });

  return results
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

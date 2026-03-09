import React from 'react';
import { Waves } from 'lucide-react';
import ProcessPage, { InputCard, Field } from './ProcessPage';

export default function WaterUtility() {
  const [form, setForm] = React.useState<any>({});
  const update = (n: string, v: any) => setForm((f: any) => ({ ...f, [n]: v }));

  return (
    <ProcessPage title="Water & Utility" icon={<Waves size={28} />} description="Water treatment, cooling, boiler, and utility tracking" flow={{ from: 'Raw Water', to: 'Process / Cooling / ETP' }} color="bg-cyan-600">
      <InputCard title="Water Consumption">
        <Field label="Raw Water Intake" name="rawWaterIntake" value={form.rawWaterIntake} onChange={update} unit="M3" />
        <Field label="RO/DM Water Produced" name="roWater" value={form.roWater} onChange={update} unit="M3" />
        <Field label="Process Water Used" name="processWater" value={form.processWater} onChange={update} unit="M3" />
        <Field label="Cooling Tower Makeup" name="coolingMakeup" value={form.coolingMakeup} onChange={update} unit="M3" />
        <Field label="Boiler Feed Water" name="boilerFeedWater" value={form.boilerFeedWater} onChange={update} unit="M3" />
      </InputCard>

      <InputCard title="ETP (Effluent Treatment)">
        <Field label="ETP Inlet Flow" name="etpInlet" value={form.etpInlet} onChange={update} unit="M3" />
        <Field label="ETP Outlet Flow" name="etpOutlet" value={form.etpOutlet} onChange={update} unit="M3" />
        <Field label="Inlet COD" name="inletCOD" value={form.inletCOD} onChange={update} unit="mg/L" />
        <Field label="Outlet COD" name="outletCOD" value={form.outletCOD} onChange={update} unit="mg/L" />
        <Field label="Inlet pH" name="inletPH" value={form.inletPH} onChange={update} />
        <Field label="Outlet pH" name="outletPH" value={form.outletPH} onChange={update} />
      </InputCard>

      <InputCard title="Cooling Tower">
        <Field label="CT Inlet Temp" name="ctInletTemp" value={form.ctInletTemp} onChange={update} unit="°C" />
        <Field label="CT Outlet Temp" name="ctOutletTemp" value={form.ctOutletTemp} onChange={update} unit="°C" />
        <Field label="CT Blowdown" name="ctBlowdown" value={form.ctBlowdown} onChange={update} unit="M3" />
        <Field label="TDS" name="tds" value={form.tds} onChange={update} unit="ppm" />
      </InputCard>

      <InputCard title="Power">
        <Field label="Total Power Consumed" name="totalPower" value={form.totalPower} onChange={update} unit="kWh" />
        <Field label="DG Set Running Hours" name="dgHours" value={form.dgHours} onChange={update} unit="hrs" />
        <Field label="DG Diesel Consumed" name="dgDiesel" value={form.dgDiesel} onChange={update} unit="L" />
      </InputCard>

      <div className="flex justify-end mt-4 mb-8"><button className="btn-primary">Save</button></div>
    </ProcessPage>
  );
}

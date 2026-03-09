import React from 'react';
import { Wind } from 'lucide-react';
import ProcessPage, { InputCard, Field } from './ProcessPage';

export default function Dryer() {
  const [form, setForm] = React.useState<any>({});
  const update = (n: string, v: any) => setForm((f: any) => ({ ...f, [n]: v }));
  const ddgsProduction = (form.ddgsBags || 0) * (form.ddgsWeight || 0) / 1000;

  return (
    <ProcessPage title="Dryer (DDGS)" icon={<Wind size={28} />} description="Spent wash processing — decanter, evaporator, and dryer to produce DDGS" flow={{ from: 'Spent Wash / Thin Slop', to: 'DDGS Product' }} color="bg-orange-600">
      <InputCard title="DDGS Production">
        <Field label="Bags Produced" name="ddgsBags" value={form.ddgsBags} onChange={update} />
        <Field label="Weight per Bag" name="ddgsWeight" value={form.ddgsWeight} onChange={update} unit="kg" />
        <Field label="DDGS Production" value={ddgsProduction} auto unit="Ton" />
      </InputCard>

      <InputCard title="Dryer Parameters">
        <Field label="Dryer Inlet Temp" name="dryerInletTemp" value={form.dryerInletTemp} onChange={update} unit="°C" />
        <Field label="Dryer Outlet Temp" name="dryerOutletTemp" value={form.dryerOutletTemp} onChange={update} unit="°C" />
        <Field label="DDGS Moisture" name="ddgsMoisture" value={form.ddgsMoisture} onChange={update} unit="%" />
        <Field label="DDGS Protein" name="ddgsProtein" value={form.ddgsProtein} onChange={update} unit="%" />
      </InputCard>

      <InputCard title="Evaporator">
        <Field label="Thin Slop Feed" name="thinSlopFeed" value={form.thinSlopFeed} onChange={update} unit="M3" />
        <Field label="Syrup Produced" name="syrupProduced" value={form.syrupProduced} onChange={update} unit="M3" />
        <Field label="Syrup Brix" name="syrupBrix" value={form.syrupBrix} onChange={update} unit="°Bx" />
        <Field label="Condensate Recovered" name="condensateRecovered" value={form.condensateRecovered} onChange={update} unit="M3" />
      </InputCard>

      <InputCard title="Decanter">
        <Field label="Spent Wash Processed" name="spentWashProcessed" value={form.spentWashProcessed} onChange={update} unit="M3" />
        <Field label="Wet Cake Produced" name="wetCake" value={form.wetCake} onChange={update} unit="Ton" />
        <Field label="Decanter Centrate" name="centrate" value={form.centrate} onChange={update} unit="M3" />
      </InputCard>

      <div className="mt-4 mb-8"><button className="btn-primary w-full md:w-auto">Save</button></div>
    </ProcessPage>
  );
}

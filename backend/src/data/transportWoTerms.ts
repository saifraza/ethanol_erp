/**
 * Default Terms & Conditions for new TRANSPORT work orders.
 * Mirrors manpowerWoTerms — body strings preserve newlines on PDF render
 * and the user can add / edit / remove sections per WO from the form.
 *
 * Stored on WorkOrder.termsAndConditions as a JSON array.
 */

import type { WoTermSection } from './manpowerWoTerms';

export const DEFAULT_TRANSPORT_TERMS: WoTermSection[] = [
  {
    title: 'Scope of Transport',
    body:
      'Transporter shall move the agreed material from the loading point at MSPIL to the destination(s) listed in the rate card.\n' +
      'Loading and unloading arrangements are as per the per-trip understanding unless agreed otherwise in writing.',
  },
  {
    title: 'Vehicle & Driver Compliance',
    body:
      'Transporter shall deploy roadworthy vehicles with valid RC, fitness, insurance, PUC, and permit covering the destination route.\n' +
      'Drivers must hold a valid commercial licence appropriate to the vehicle class and follow MSPIL gate, PPE, and safety norms.',
  },
  {
    title: 'Loading & Weighment',
    body:
      'Net weight at MSPIL\'s certified weighbridge is the basis for billing — both empty and loaded weights must be captured at the gate.\n' +
      'Any tarp, lashing, or load-securing arrangement is the transporter\'s responsibility.',
  },
  {
    title: 'Transit & Delivery',
    body:
      'Material shall reach the destination in the same condition it left the gate. Transit losses, pilferage, or contamination are the transporter\'s liability and will be recovered from the freight bill.\n' +
      'Proof of delivery (signed POD / unloading acknowledgement) must accompany every freight invoice.',
  },
  {
    title: 'Rates & Billing',
    body:
      'Freight rates per tonne / per km / per trip are as set out in the rate card attached. Rates are inclusive of driver bhatta, halting, and standard detention; any deviation must be pre-approved in writing.\n' +
      'GST, toll, and statutory levies are extra against valid documents.',
  },
  {
    title: 'Statutory Compliance',
    body:
      'Transporter is responsible for vehicle taxes, RTO compliance, GST registration, and e-way bill generation where applicable.\n' +
      'TDS under Section 194C will be deducted by the Company at applicable rates against PAN.',
  },
  {
    title: 'Insurance & Liability',
    body:
      'The transporter\'s goods-in-transit insurance covers material from gate-out to destination. The Company is not liable for any accident, damage, theft, or loss during transit.',
  },
  {
    title: 'Termination',
    body: 'This work order is valid for the period agreed at the time of issue and may be terminated by either party with 7 days written notice or for cause without notice.',
  },
  {
    title: 'Dispute Resolution',
    body:
      'Any dispute will be settled amicably.\n' +
      'If unresolved, the jurisdiction shall be Narsinghpur courts only.',
  },
];

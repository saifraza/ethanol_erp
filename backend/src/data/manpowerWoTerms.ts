/**
 * Default Terms & Conditions for new MANPOWER_SUPPLY work orders.
 * Sourced from the MSPIL Ram Uttam Yadav WO template (May 2026).
 *
 * The user can edit/add/remove sections per WO in the WorkOrder form.
 * Stored on WorkOrder.termsAndConditions as a JSON array.
 *
 * Body strings preserve newlines on PDF render.
 */

export interface WoTermSection {
  title: string;
  body: string;
}

export const DEFAULT_MANPOWER_TERMS: WoTermSection[] = [
  {
    title: 'Labor Deployment',
    body:
      'Contractor will deploy physically fit and experienced labourers as agreed.\n' +
      'Replacement shall be provided if any labour is found unfit or unskilled.',
  },
  {
    title: 'Work Responsibility',
    body:
      'Laborers shall work only as per the instructions given by the authorized client representative.\n' +
      'Contractor is responsible for labor discipline and behavior.',
  },
  {
    title: 'Safety & Compliance',
    body:
      'Contractor must ensure safety equipment where required.\n' +
      'Client shall not be held liable for any injury or accident of the labor during work.\n' +
      'EPF @ 13% and ESI @ 3.25% shall be paid extra by the Company to the Contractor against monthly billing, subject to submission of valid EPF ECR and ESI payment challan receipts along with the invoice. In case the required challans/documents are not submitted, the respective payment shall remain on hold until verification and submission of the same.',
  },
  {
    title: 'Damage & Liability',
    body:
      'Labour will handle materials carefully; however:\n' +
      'Minor operational damages are not the contractor’s liability.\n' +
      'Major damage due to negligence will be compensated as mutually agreed.',
  },
  {
    title: 'Termination of Work Order',
    body: 'This work order will remain valid for the period agreed at the time of issue.',
  },
  {
    title: 'Dispute Resolution',
    body:
      'Any dispute will be settled amicably.\n' +
      'If unresolved, the jurisdiction shall be Narsinghpur courts only.',
  },
  {
    title: 'Duties & Taxes',
    body: 'Taxes and duties, PF, ESI etc. extra as applicable according to law, at the time of billing.',
  },
];

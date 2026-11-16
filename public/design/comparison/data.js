/* Illustrative data for the Comparison proposals (#370). Nothing here is real: the vendors, Systems and people are
   invented, and the people are the ones of the app bar's acting-user switch (public/design/shared/appbar.js) plus a few
   more System owners.

   A Candidate's answers are one string, one character per first-round Control of the Comparison, in the order of the
   Comparison's `controls` list:
     F Fulfilled   P In Progress   N not started (unanswered)   W Waived   A Not Applicable   X does not apply to this Candidate
   Every figure on the pages (Comparison Score, answered count, mandatory Controls not fulfilled) is computed from these
   strings in comparison.js, so the figures can never disagree with the table. The rules are in
   docs/how-it-works/comparison.md:
     score = Fulfilled / (first-round Controls that apply - Not Applicable); Waived, In Progress and unanswered count as
     not fulfilled; a Control that does not apply (X) is not in the set at all.

   Worked example from the document: "Hexa HR" has 14 first-round Controls, 1 Not Applicable, 9 Fulfilled, 1 Waived,
   1 In Progress and 2 unanswered: 9 / 13 = 69%, "incomplete: 12 of 14 answered". */
window.CMP_DATA = (function () {
  // Every first-round Control the examples use. `mand` = mandatory; `fw` = the Framework whose owner marked it first round.
  const controls = {
    c1:  { code: 'CTL-012', name: 'Single sign-on and multi-factor authentication', fw: 'ISO 27001', mand: true },
    c2:  { code: 'CTL-021', name: 'Encryption of data at rest', fw: 'ISO 27001', mand: true },
    c3:  { code: 'CTL-022', name: 'Encryption of data in transit', fw: 'ISO 27001', mand: true },
    c4:  { code: 'CTL-031', name: 'Tested backup and restore', fw: 'ISO 27001', mand: false },
    c5:  { code: 'CTL-044', name: 'Audit logging of administrator actions', fw: 'ISO 27001', mand: true },
    c6:  { code: 'CTL-051', name: 'Role-based access control', fw: 'ISO 27001', mand: true },
    c7:  { code: 'CTL-063', name: 'Vulnerabilities patched within the agreed time', fw: 'NIS2', mand: true },
    c8:  { code: 'CTL-064', name: 'Incidents reported within 24 hours', fw: 'NIS2', mand: true },
    c9:  { code: 'CTL-072', name: 'Business continuity plan', fw: 'NIS2', mand: true },
    c10: { code: 'CTL-081', name: 'Data processing agreement signed', fw: 'GDPR', mand: true },
    c11: { code: 'CTL-082', name: 'Personal data stored within the EU/EEA', fw: 'GDPR', mand: true },
    c12: { code: 'CTL-083', name: 'Subprocessors listed and approved', fw: 'GDPR', mand: false },
    c13: { code: 'CTL-091', name: 'Exit plan and data portability', fw: 'Cloud Controls Matrix', mand: false },
    c14: { code: 'CTL-092', name: 'Independent assurance report (SOC 2 or ISO 27001 certificate)', fw: 'Cloud Controls Matrix', mand: true },
    c15: { code: 'CTL-101', name: 'Physical protection of the server room', fw: 'ISO 27001', mand: true },
    c16: { code: 'CTL-102', name: 'Own patch management of the platform', fw: 'ISO 27001', mand: false },
  };
  // The first-round Controls a Comparison starts with when its first Candidate is added to an empty one.
  const defaultControls = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14'];

  const SENS = ['Public', 'Internal', 'Sensitive', 'Highly Sensitive', 'Critical Sensitivity'];
  const SAAS = ['SaaS'], ONPREM = ['On-premises'], HOSTED = ['Hosted (IaaS)'];
  const scopeA = ['ISO 27001', 'GDPR', 'NIS2'];
  const noRisks = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const rk = (c, h, m, l) => ({ CRITICAL: c, HIGH: h, MEDIUM: m, LOW: l });

  const comparisons = [
    {
      id: 'hr',
      name: 'New HR system 2027',
      need: 'Replace the spreadsheet-and-email way of running onboarding, absences and payroll export with one system, live before the 2027 budget year.',
      owner: 'Marcus Lindqvist', participants: ['Eva Strand'], created: '2026-10-05',
      closed: false, outcome: null,
      controls: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14'],
      cands: [
        { id: 'lumo', name: 'Lumo HR', vendor: 'Lumo Software AB', owner: 'Marcus Lindqvist', bso: 'Lena Holm', stage: 'First round', state: 'active',
          facets: SAAS, sens: 'Highly Sensitive', integ: 'Moderate', avail: 'High', scope: scopeA, risks: rk(0, 1, 2, 1), st: 'FFFFFFFFFFFPFF' },
        { id: 'stream', name: 'PeopleStream', vendor: 'Stream Nordic AB', owner: 'Marcus Lindqvist', bso: 'Lena Holm', stage: 'First round', state: 'active',
          facets: SAAS, sens: 'Highly Sensitive', integ: 'Moderate', avail: 'High', scope: scopeA, risks: rk(0, 2, 1, 0), st: 'FFFFFFWFFFFFAF' },
        { id: 'bramble', name: 'Bramble HR', vendor: 'Bramble Cloud Ltd', owner: 'Eva Strand', bso: 'Marcus Lindqvist', stage: 'Risk Analysis', state: 'active',
          facets: SAAS, sens: 'Highly Sensitive', integ: 'Moderate', avail: 'High', scope: scopeA, risks: rk(1, 1, 3, 2), st: 'FFFFPFFFFPFWFF' },
        { id: 'orbit', name: 'Orbit People', vendor: 'Orbit Systems GmbH', owner: 'Eva Strand', bso: 'Marcus Lindqvist', stage: 'Qualification', state: 'rejected',
          facets: SAAS, sens: 'Highly Sensitive', integ: 'Moderate', avail: 'High', scope: scopeA, risks: rk(2, 1, 0, 0), st: 'FFFPFFPFPFPFFF' },
        // The worked example from docs/how-it-works/comparison.md: 9 Fulfilled, 1 Waived, 1 In Progress, 1 Not Applicable, 2 unanswered.
        { id: 'hexa', name: 'Hexa HR', vendor: 'Hexa Labs AB', owner: 'Marcus Lindqvist', bso: 'Lena Holm', stage: 'First round', state: 'active',
          facets: SAAS, sens: 'Highly Sensitive', integ: 'Moderate', avail: 'High', scope: scopeA, risks: rk(0, 1, 1, 0), st: 'FFFPFFWFNFFNAF' },
      ],
    },
    {
      id: 'crm',
      name: 'CRM platform replacement',
      need: 'Sales and customer support need one customer register. The current on-premises CRM runs on an operating system that leaves support next year.',
      owner: 'Johan Berg', participants: ['Marcus Lindqvist', 'Elin Nord'], created: '2026-10-19',
      closed: false, outcome: null,
      controls: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c10', 'c11', 'c13', 'c14', 'c15', 'c16'],
      cands: [
        { id: 'cloudcast', name: 'Cloudcast CRM', vendor: 'Cloudcast Inc.', owner: 'Marcus Lindqvist', bso: 'Lena Holm', stage: 'First round', state: 'active',
          facets: SAAS, sens: 'Sensitive', integ: 'Moderate', avail: 'High', scope: scopeA, risks: rk(0, 1, 2, 2), st: 'FFFFFPFFFFFFXX' },
        { id: 'northwind', name: 'Northwind CRM On-Prem', vendor: 'Northwind Software AB', owner: 'Elin Nord', bso: 'Lena Holm', stage: 'Risk Analysis', state: 'active',
          facets: ONPREM, sens: 'Highly Sensitive', integ: 'High', avail: 'High', scope: ['ISO 27001', 'NIS2'], risks: rk(1, 2, 1, 0), st: 'FFFFFWFFFXFXPF' },
        { id: 'pipeline', name: 'Pipeline Hosted', vendor: 'Pipeline Systems Oy', owner: 'Elin Nord', bso: 'Lena Holm', stage: 'First round', state: 'active',
          facets: HOSTED, sens: 'Sensitive', integ: 'Moderate', avail: 'Moderate', scope: scopeA, risks: rk(0, 0, 2, 3), st: 'FFFNFFWFFPNFXP' },
      ],
    },
    {
      id: 'edr',
      name: 'Endpoint protection 2026',
      need: 'The antivirus licence ends in December. Pick an endpoint detection and response product for all laptops and servers.',
      owner: 'Marcus Lindqvist', participants: [], created: '2026-08-24',
      closed: true,
      outcome: { pick: 'shield', by: 'Marcus Lindqvist', on: '2026-09-18',
        comment: 'Aegis Endpoint scores slightly higher, but costs twice as much per device and needs a new management console. ShieldOne plugs into the console we already run, and its one Waived Control has an accepted plan.' },
      controls: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c11', 'c12', 'c13'],
      cands: [
        { id: 'shield', name: 'ShieldOne', vendor: 'ShieldOne AB', owner: 'Marcus Lindqvist', bso: 'Lena Holm', stage: 'Second round', state: 'active',
          facets: SAAS, sens: 'Sensitive', integ: 'High', avail: 'High', scope: scopeA, risks: rk(0, 0, 2, 1), st: 'FFFFFFFWFFAF' },
        { id: 'aegis', name: 'Aegis Endpoint', vendor: 'Aegis Security Ltd', owner: 'Eva Strand', bso: 'Marcus Lindqvist', stage: 'Authorized to operate', state: 'active', ato: true,
          facets: SAAS, sens: 'Sensitive', integ: 'High', avail: 'High', scope: scopeA, risks: rk(0, 1, 0, 2), st: 'FFFPFFFFFFFF' },
        { id: 'ward', name: 'Ward EDR', vendor: 'Ward Cyber GmbH', owner: 'Marcus Lindqvist', bso: 'Lena Holm', stage: 'Risk Analysis', state: 'notselected',
          facets: SAAS, sens: 'Sensitive', integ: 'High', avail: 'High', scope: scopeA, risks: rk(0, 2, 1, 0), st: 'FFFFWFFFPPFF' },
      ],
    },
    {
      id: 'bi',
      name: 'BI and dashboard tool 2026',
      need: 'Finance and Operations want self-service dashboards on top of the data warehouse.',
      owner: 'Johan Berg', participants: ['Elin Nord'], created: '2026-05-04',
      closed: true,
      outcome: { pick: null, by: 'Johan Berg', on: '2026-06-12',
        comment: 'Neither product keeps personal data inside the EU/EEA yet. Both vendors promise EU regions in 2027, so we revisit then and keep the current reports until we do.' },
      controls: ['c1', 'c2', 'c3', 'c5', 'c6', 'c7', 'c8', 'c10', 'c11', 'c12', 'c13', 'c14'],
      cands: [
        { id: 'dashly', name: 'Dashly', vendor: 'Dashly Analytics Inc.', owner: 'Elin Nord', bso: 'Lena Holm', stage: 'Risk Analysis', state: 'active',
          facets: SAAS, sens: 'Internal', integ: 'Moderate', avail: 'Moderate', scope: scopeA, risks: rk(0, 1, 1, 1), st: 'FFFFFFFFPFWF' },
        { id: 'insight', name: 'Insightable', vendor: 'Insightable Oy', owner: 'Priya Shah', bso: 'Lena Holm', stage: 'First round', state: 'active',
          facets: SAAS, sens: 'Internal', integ: 'Moderate', avail: 'Moderate', scope: scopeA, risks: rk(0, 0, 3, 1), st: 'FFFFFFFFWFFF' },
      ],
    },
  ];

  // Systems that can be added as a Candidate (staged, not closed). A participant sees only the ones they own.
  const pool = [
    { id: 'kestrel', name: 'Kestrel HR', vendor: 'Kestrel Software AB', owner: 'Marcus Lindqvist', stage: 'First round', facets: SAAS, sens: 'Highly Sensitive', integ: 'Moderate', avail: 'High', scope: scopeA, risks: noRisks },
    { id: 'leadwave', name: 'Leadwave CRM', vendor: 'Leadwave Inc.', owner: 'Marcus Lindqvist', stage: 'First round', facets: SAAS, sens: 'Sensitive', integ: 'Moderate', avail: 'High', scope: scopeA, risks: noRisks },
    { id: 'tandem', name: 'Tandem Sales', vendor: 'Tandem AS', owner: 'Elin Nord', stage: 'First round', facets: SAAS, sens: 'Sensitive', integ: 'Moderate', avail: 'High', scope: scopeA, risks: noRisks },
    { id: 'olive', name: 'Olive Contacts', vendor: 'Olive Labs AB', owner: 'Eva Strand', stage: 'First round', facets: SAAS, sens: 'Internal', integ: 'Low', avail: 'Moderate', scope: scopeA, risks: noRisks },
  ];

  return { controls, defaultControls, SENS, comparisons, pool };
})();

/* Example data for the staged-evaluation proposals (#327, PRD 0002). Five Systems, so a viewer can see every part of
   the flow: a low-risk SaaS tool on the Self track at OG3 (sent back once before), a critical platform on the Full
   track at OG3 whose OG2 went against an Advise-against, a Full-track System part-way through OAG review (sent back to
   the first round earlier), a System rejected at Qualification, and a new System at OG1 with its Track not chosen yet.

   The Business System Owner (BSO) is a per-System assignment of any User, not a role. Here Lena Holm (the Business Risk
   Owner persona in the app bar) is the BSO of every System, so acting as her shows the decision panel. Marcus Lindqvist
   (System Owner) owns Fika Pulse, Orbit Expense and none of the others; nobody decides a gate on a System they own. */
window.EV_DATA = (function () {
  // Stages. `long` names a stage where the same label appears twice on a Track.
  const stages = {
    r1:   { label: 'First round', long: 'First round', kind: 'round', hint: 'The vendor-evaluation Controls, answered before the Track is chosen.' },
    ra1:  { label: 'Risk Analysis', long: 'Risk Analysis (first round)', kind: 'ra', hint: 'The stakeholders gather the System’s Risks and give each a Risk owner.' },
    og1:  { label: 'OG1', long: 'OG1: choose the Track', kind: 'gate', hint: 'Each Onboarding Advisory Group with first-round Controls in its remit, plus the base review, gives a verdict: Self or Full.' },
    fork: { label: 'Self or Full', long: 'Second round onwards', kind: 'fork', hint: 'What follows depends on the Track OG1 chooses.' },
    qual: { label: 'Qualification', long: 'Qualification', kind: 'gate', hint: 'The BSO checks the System is worth a full evaluation.' },
    doc1: { label: 'First documentation', long: 'First documentation', kind: 'doc', hint: 'The Document Requirements for this stage, linked and marked provided by the System’s owner.' },
    oag1: { label: 'OAG review', long: 'OAG review (before OG2)', kind: 'oag', hint: 'Each group with a remit gives a Recommendation.' },
    og2:  { label: 'OG2', long: 'OG2: proceed?', kind: 'gate', hint: 'The BSO decides whether the System proceeds to the second round.' },
    r2:   { label: 'Second round', long: 'Second round', kind: 'round', hint: 'The rest of the applicable Controls, plus second-round documentation.' },
    ra2:  { label: 'Risk Analysis', long: 'Risk Analysis (before OG3)', kind: 'ra', hint: 'Every open Risk gets a Risk owner before the BSO decides.' },
    oag2: { label: 'OAG review', long: 'OAG review (before OG3)', kind: 'oag', hint: 'Each group with a remit gives a Recommendation.' },
    og3:  { label: 'OG3', long: 'OG3: authorize to operate?', kind: 'gate', hint: 'The BSO decides whether the System may operate.' },
    ato:  { label: 'Authorized to operate', long: 'Authorized to operate (ATO)', kind: 'end', hint: 'The System’s owner or an Admin then marks the System Onboarded.' },
  };
  const tracks = {
    SELF: ['r1', 'ra1', 'og1', 'r2', 'ra2', 'og3', 'ato'],
    FULL: ['r1', 'ra1', 'og1', 'qual', 'doc1', 'oag1', 'og2', 'r2', 'ra2', 'oag2', 'og3', 'ato'],
  };
  // The Onboarding Advisory Group: the base review and one group per Review Group. Shown as the group's, not the person's.
  const groups = {
    BASE:  { name: 'Base review', code: 'BR', members: ['Sara Ek'] },
    GDPR:  { name: 'GDPR Review Group', code: 'GD', members: ['Nils Aberg'] },
    CYBER: { name: 'Cyber Security Review Group', code: 'CS', members: ['Ines Falk'] },
  };

  const u = (name) => ({ name, kind: 'user' });
  const out = (name, org) => ({ name, kind: 'outsider', org });

  const systems = [
    {
      id: 'fika', name: 'Fika Pulse', mark: 'FP', vendor: 'Fika Labs AB', facets: ['SaaS'], impact: 'Low',
      desc: 'Weekly pulse survey for staff. Anonymous answers, two administrators.',
      owner: 'Marcus Lindqvist', bso: 'Lena Holm', track: 'SELF', stage: 'og3', outcome: null,
      firstRound: { done: 14, total: 14 }, secondRound: { done: 41, total: 41 }, controls: 55,
      og1: { on: '2026-10-14', verdicts: [
        { group: 'BASE', verdict: 'SELF', remit: 'Base Controls', comment: 'Standard SaaS tool. Nothing in the first round needs a documented evaluation.' },
        { group: 'GDPR', verdict: 'SELF', remit: '3 first-round Controls', comment: 'Only work email addresses are processed, no special categories.' },
      ] },
      recs: {},
      docs: [
        { name: 'Data processing agreement', stage: 'r2', tracks: ['SELF', 'FULL'], provided: true, link: 'docs.example.com/fika/dpa', by: 'Marcus Lindqvist', on: '2026-11-03' },
        { name: 'Retention schedule for survey answers', stage: 'r2', tracks: ['SELF', 'FULL'], provided: true, link: 'docs.example.com/fika/retention', by: 'Marcus Lindqvist', on: '2026-11-05' },
      ],
      risks: [
        { id: 'R1', title: 'Survey answers kept indefinitely', sev: 'MEDIUM', source: 'REQ', owner: 'Marcus Lindqvist', status: 'OPEN' },
        { id: 'R2', title: 'Vendor support staff can read free-text answers', sev: 'LOW', source: 'ADHOC', owner: 'Johan Berg', status: 'OPEN' },
        { id: 'R3', title: 'SSO not enforced for survey administrators', sev: 'MEDIUM', source: 'REQ', owner: 'Priya Shah', status: 'OPEN' },
        { id: 'R4', title: 'Export of raw answers to CSV is not logged', sev: 'LOW', source: 'REQ', owner: 'Marcus Lindqvist', status: 'OPEN' },
      ],
      analyses: [
        { stage: 'ra1', date: '2026-10-12', by: 'Johan Berg', people: [u('Marcus Lindqvist'), u('Sara Ek'), out('Mia Roth', 'Fika Labs AB (vendor)')], notes: 'Vendor confirmed EU hosting. Two Risks raised, both small.', reviewed: [], raised: ['R2', 'R3'] },
        { stage: 'ra2', date: '2026-11-04', by: 'Johan Berg', people: [u('Marcus Lindqvist'), u('Johan Berg'), u('Priya Shah')], notes: 'Retention is now a written schedule. R1 stays open until the vendor applies the 12-month limit.', reviewed: ['R2', 'R3'], raised: ['R1', 'R4'] },
      ],
      decisions: [
        { gate: 'og1', on: '2026-10-14', by: null, outcome: 'SELF', comment: 'Every group with a remit gave Self.' },
        { gate: 'og3', on: '2026-11-02', by: 'Lena Holm', outcome: 'BACK', backTo: 'r2', comment: 'No retention period for survey answers. Add one to the second round and send it again.' },
      ],
    },
    {
      id: 'helios', name: 'Helios Payments Platform', mark: 'HP', vendor: 'Helios Financial Systems', facets: ['SaaS', 'Cloud IaaS/PaaS'], impact: 'Critical',
      desc: 'Card payments and settlement for every webshop. Replaces the legacy payment gateway.',
      owner: 'Priya Shah', bso: 'Lena Holm', track: 'FULL', stage: 'og3', outcome: null,
      firstRound: { done: 22, total: 22 }, secondRound: { done: 118, total: 118 }, controls: 140,
      og1: { on: '2026-09-19', verdicts: [
        { group: 'BASE', verdict: 'FULL', remit: 'Base Controls', comment: 'Handles card data and is business critical.' },
        { group: 'GDPR', verdict: 'FULL', remit: '9 first-round Controls', comment: 'Personal data at scale. A DPIA is needed.' },
        { group: 'CYBER', verdict: 'FULL', remit: '6 first-round Controls', comment: 'An essential service under Cybersäkerhetslagen.' },
      ] },
      recs: {
        oag1: [
          { group: 'BASE', rec: 'CONDITIONS', comment: 'Architecture is sound.', conditions: 'SSO for every administrator role before OG3.' },
          { group: 'GDPR', rec: 'AGAINST', comment: 'The DPIA shows transfers to a US sub-processor with no valid transfer mechanism.' },
          { group: 'CYBER', rec: 'RECOMMEND', comment: 'Incident reporting duties are covered by the contract.' },
        ],
        oag2: [
          { group: 'BASE', rec: 'CONDITIONS', comment: 'Controls are in place. MFA for vendor support is still open.', conditions: 'Close the MFA Risk or accept it formally, within 30 days of ATO.' },
          { group: 'GDPR', rec: 'AGAINST', comment: 'The US sub-processor is still in the data flow. The EU cutover has not happened.' },
          { group: 'CYBER', rec: 'CONDITIONS', comment: 'Controls hold up in the second round.', conditions: 'Run a restore test within 30 days of ATO.' },
        ],
      },
      docs: [
        { name: 'Architecture description', stage: 'doc1', tracks: ['FULL'], provided: true, link: 'docs.example.com/helios/architecture', by: 'Priya Shah', on: '2026-09-27' },
        { name: 'Data protection impact assessment', stage: 'doc1', tracks: ['FULL'], provided: true, link: 'docs.example.com/helios/dpia', by: 'Priya Shah', on: '2026-09-29' },
        { name: 'Operations handover plan', stage: 'r2', tracks: ['FULL'], provided: true, link: 'docs.example.com/helios/handover', by: 'Priya Shah', on: '2026-10-24' },
        { name: 'Exit plan', stage: 'r2', tracks: ['SELF', 'FULL'], provided: true, link: 'docs.example.com/helios/exit', by: 'Priya Shah', on: '2026-10-24' },
      ],
      risks: [
        { id: 'R1', title: 'US sub-processor without a transfer mechanism', sev: 'CRITICAL', source: 'REQ', owner: 'Priya Shah', status: 'OPEN' },
        { id: 'R2', title: 'Vendor support accounts without MFA', sev: 'HIGH', source: 'REQ', owner: 'Johan Berg', status: 'OPEN' },
        { id: 'R3', title: 'No tested restore of the settlement database', sev: 'HIGH', source: 'AUDIT', owner: 'Elena Voss', status: 'OPEN' },
        { id: 'R4', title: 'Single payment acquirer', sev: 'MEDIUM', source: 'ADHOC', owner: 'Lena Holm', status: 'OPEN' },
        { id: 'R5', title: 'Webhook endpoints accept unsigned callbacks in test mode', sev: 'MEDIUM', source: 'REQ', owner: 'Priya Shah', status: 'OPEN' },
        { id: 'R6', title: 'Release notes arrive after deployment', sev: 'LOW', source: 'ADHOC', owner: 'Marcus Lindqvist', status: 'OPEN' },
        { id: 'R7', title: 'Legacy gateway credentials not yet revoked', sev: 'MEDIUM', source: 'AUDIT', owner: 'Default Admin', status: 'OPEN' },
      ],
      analyses: [
        { stage: 'ra1', date: '2026-09-20', by: 'Johan Berg', people: [u('Priya Shah'), u('Sara Ek'), u('Johan Berg'), out('Tomas Wiik', 'Helios Financial Systems (vendor)')], notes: 'Sub-processor list reviewed with the vendor. Cutover to an EU-hosted sub-processor is planned for Q1.', reviewed: [], raised: ['R1', 'R2', 'R4'] },
        { stage: 'ra2', date: '2026-10-28', by: 'Johan Berg', people: [u('Priya Shah'), u('Johan Berg'), u('Elena Voss'), out('Tomas Wiik', 'Helios Financial Systems (vendor)'), out('Karin Sund', 'External auditor')], notes: 'Every open Risk now has an owner. The restore test is scheduled but not run.', reviewed: ['R1', 'R2', 'R4'], raised: ['R3', 'R5', 'R6', 'R7'] },
      ],
      decisions: [
        { gate: 'og1', on: '2026-09-19', by: null, outcome: 'FULL', comment: 'Every group with a remit gave Full.' },
        { gate: 'qual', on: '2026-09-24', by: 'Lena Holm', outcome: 'GO', comment: 'Worth a full evaluation: it replaces the legacy payment gateway.' },
        { gate: 'og2', on: '2026-10-02', by: 'Lena Holm', outcome: 'GO', comment: 'Proceed to the second round. The transfer problem becomes a Risk with an owner.',
          against: [{ group: 'GDPR', rec: 'The DPIA shows transfers to a US sub-processor with no valid transfer mechanism.',
            justification: 'The vendor is moving to an EU-hosted sub-processor in Q1, and the Nordic card launch cannot wait for it. I accept the exposure until cutover. Priya Shah owns the Risk and reports monthly.' }] },
      ],
    },
    {
      id: 'atlas', name: 'Atlas Data Warehouse', mark: 'AD', vendor: 'Brightpeak Analytics', facets: ['SaaS'], impact: 'High',
      desc: 'Managed warehouse for finance and sales reporting, loaded nightly from the ERP.',
      owner: 'Elena Voss', bso: 'Lena Holm', track: 'FULL', stage: 'oag1', outcome: null,
      firstRound: { done: 20, total: 20 }, secondRound: { done: 0, total: 96 }, controls: 116,
      og1: { on: '2026-10-27', verdicts: [
        { group: 'BASE', verdict: 'FULL', remit: 'Base Controls', comment: 'Holds the full ERP extract.' },
        { group: 'GDPR', verdict: 'FULL', remit: '7 first-round Controls', comment: 'Customer records, hosted in a new region.' },
        { group: 'CYBER', verdict: 'SELF', remit: '4 first-round Controls', comment: 'Nothing here is an essential service.' },
      ] },
      recs: {
        oag1: [
          { group: 'BASE', rec: null, comment: '', conditions: '' },
          { group: 'GDPR', rec: 'CONDITIONS', comment: 'The region change is acceptable if the contract names it.', conditions: 'The data processing agreement lists the new hosting region.' },
          { group: 'CYBER', rec: null, comment: '', conditions: '' },
        ],
      },
      docs: [
        { name: 'Architecture description', stage: 'doc1', tracks: ['FULL'], provided: true, link: 'docs.example.com/atlas/architecture', by: 'Elena Voss', on: '2026-11-04' },
        { name: 'Data protection impact assessment', stage: 'doc1', tracks: ['FULL'], provided: true, link: 'docs.example.com/atlas/dpia', by: 'Elena Voss', on: '2026-11-04' },
        { name: 'Operations handover plan', stage: 'r2', tracks: ['FULL'], provided: false },
        { name: 'Exit plan', stage: 'r2', tracks: ['SELF', 'FULL'], provided: false },
      ],
      risks: [
        { id: 'R1', title: 'Hosting region changed after contract signature', sev: 'HIGH', source: 'ADHOC', owner: 'Elena Voss', status: 'OPEN' },
        { id: 'R2', title: 'Service accounts share one key for every ERP load', sev: 'MEDIUM', source: 'REQ', owner: 'Johan Berg', status: 'OPEN' },
        { id: 'R3', title: 'Exports to the object store are public by default', sev: 'HIGH', source: 'REQ', owner: null, status: 'OPEN' },
        { id: 'R4', title: 'No column-level access in the finance schema', sev: 'MEDIUM', source: 'REQ', owner: 'Elena Voss', status: 'OPEN' },
      ],
      analyses: [
        { stage: 'ra1', date: '2026-10-08', by: 'Johan Berg', people: [u('Elena Voss'), u('Johan Berg'), out('Dag Holm', 'Brightpeak Analytics (vendor)')], notes: 'Hosting region still to be confirmed. Run again after the answers are re-given.', reviewed: [], raised: ['R1', 'R2', 'R4'] },
      ],
      decisions: [
        { gate: 'og1', on: '2026-10-14', by: null, outcome: 'FULL', comment: 'Two groups gave Full.' },
        { gate: 'qual', on: '2026-10-21', by: 'Lena Holm', outcome: 'BACK', backTo: 'r1', comment: 'The vendor moved hosting to another region after we started. Re-answer the first round. OG1 runs again.' },
        { gate: 'og1', on: '2026-10-27', by: null, outcome: 'FULL', comment: 'Run again after the first round was re-answered. Two groups gave Full.' },
        { gate: 'qual', on: '2026-10-30', by: 'Lena Holm', outcome: 'GO', comment: 'Yes. The new region is documented and the DPIA covers it.' },
      ],
    },
    {
      id: 'nimbus', name: 'Nimbus Chat', mark: 'NC', vendor: 'Nimbus Collab Inc.', facets: ['SaaS'], impact: 'Moderate',
      desc: 'Team chat that several departments want next to the tools they already have.',
      owner: 'Priya Shah', bso: 'Lena Holm', track: 'FULL', stage: 'qual', outcome: 'REJECTED',
      firstRound: { done: 17, total: 17 }, secondRound: { done: 0, total: 0 }, controls: 17,
      og1: { on: '2026-10-22', verdicts: [
        { group: 'BASE', verdict: 'FULL', remit: 'Base Controls', comment: 'Message content may carry personal data and the vendor hosts outside the EEA.' },
        { group: 'GDPR', verdict: 'FULL', remit: '5 first-round Controls', comment: 'No transfer mechanism offered.' },
        { group: 'CYBER', verdict: 'SELF', remit: '3 first-round Controls', comment: 'Not an essential service.' },
      ] },
      recs: {},
      docs: [],
      risks: [
        { id: 'R1', title: 'Messages stored outside the EEA', sev: 'HIGH', source: 'REQ', owner: 'Priya Shah', status: 'OPEN' },
        { id: 'R2', title: 'Duplicates a tool already in use', sev: 'LOW', source: 'ADHOC', owner: 'Priya Shah', status: 'OPEN' },
      ],
      analyses: [
        { stage: 'ra1', date: '2026-10-20', by: 'Johan Berg', people: [u('Priya Shah'), u('Johan Berg')], notes: 'Vendor did not join. Two Risks raised.', reviewed: [], raised: ['R1', 'R2'] },
      ],
      decisions: [
        { gate: 'og1', on: '2026-10-22', by: null, outcome: 'FULL', comment: 'Two groups gave Full.' },
        { gate: 'qual', on: '2026-10-27', by: 'Lena Holm', outcome: 'REJECT', comment: 'It duplicates Teams and the vendor hosts outside the EEA. Not worth a full evaluation. Final.' },
      ],
    },
    {
      id: 'orbit', name: 'Orbit Expense', mark: 'OE', vendor: 'Orbit Software', facets: ['SaaS'], impact: 'Moderate',
      desc: 'Expense claims and receipts for all employees, paid out through payroll.',
      owner: 'Marcus Lindqvist', bso: 'Lena Holm', track: null, stage: 'og1', outcome: null,
      firstRound: { done: 18, total: 18 }, secondRound: { done: 0, total: 0 }, controls: 18,
      og1: { on: null, verdicts: [
        { group: 'BASE', verdict: 'SELF', remit: 'Base Controls', comment: 'Common SaaS pattern.' },
        { group: 'GDPR', verdict: 'FULL', remit: '6 first-round Controls', comment: 'Receipts can show employee bank details and health costs.' },
        { group: 'CYBER', verdict: null, remit: '3 first-round Controls', comment: '' },
      ] },
      recs: {},
      docs: [],
      risks: [
        { id: 'R1', title: 'Receipts with bank details stored unencrypted', sev: 'HIGH', source: 'REQ', owner: 'Marcus Lindqvist', status: 'OPEN' },
        { id: 'R2', title: 'Approval chain can be skipped by a deputy', sev: 'MEDIUM', source: 'ADHOC', owner: 'Johan Berg', status: 'OPEN' },
      ],
      analyses: [
        { stage: 'ra1', date: '2026-11-05', by: 'Johan Berg', people: [u('Marcus Lindqvist'), u('Johan Berg'), out('Lisa Nord', 'Orbit Software (vendor)')], notes: 'First round answered. Two Risks raised, both with owners.', reviewed: [], raised: ['R1', 'R2'] },
      ],
      decisions: [],
    },
  ];

  return { stages, tracks, groups, systems, today: '2026-11-08' };
})();

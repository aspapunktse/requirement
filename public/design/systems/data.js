/* Shared example data for both systems-list proposals: ~120 Systems generated deterministically,
   shaped like the System model (status, owner, Deployment Facets, CIA Impact Levels,
   Business Units, Provider flag, open questions, control progress). Illustrative only. */
(function () {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const STATUSES = [
    { key: 'DRAFT', label: 'Draft', tone: 'neutral' },
    { key: 'IN_REVIEW', label: 'In review', tone: 'warn' },
    { key: 'APPROVED', label: 'Approved', tone: 'success' },
    { key: 'ONBOARDED', label: 'Onboarded', tone: 'done' },
    { key: 'REJECTED', label: 'Rejected', tone: 'danger' }
  ];
  const FACETS = [
    { key: 'S', label: 'SaaS' },
    { key: 'C', label: 'Cloud IaaS/PaaS' },
    { key: 'O', label: 'On-Premises Datacenter' }
  ];
  const LEVELS = [null, 'LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
  const UNITS = ['Engineering', 'IT Operations', 'HR', 'Finance', 'Legal', 'Sales', 'Marketing', 'Customer Support'];
  const OWNERS = ['Priya Shah', 'Marcus Lindqvist', 'Elena Voss', 'Jonas Berg', 'Amira Haddad', 'Lucas Ortega', 'Sofia Nilsson', 'Kenji Mori', 'Hanna Ek', 'David Okafor'];
  const NAMES = [
    ['Jira', 'Atlassian'], ['Confluence', 'Atlassian'], ['Microsoft 365', 'Microsoft'], ['OpenText', 'OpenText'],
    ['Salesforce', 'Salesforce'], ['Workday', 'Workday'], ['SAP S/4HANA', 'SAP'], ['ServiceNow', 'ServiceNow'],
    ['GitHub Enterprise', 'GitHub'], ['Slack', 'Salesforce'], ['Zoom', 'Zoom'], ['DocuSign', 'DocuSign'],
    ['HubSpot', 'HubSpot'], ['Zendesk', 'Zendesk'], ['Okta', 'Okta'], ['Entra ID', 'Microsoft'],
    ['Azure landing zone', 'Microsoft'], ['AWS Organisation', 'Amazon'], ['Datadog', 'Datadog'], ['Splunk', 'Cisco'],
    ['Snowflake', 'Snowflake'], ['Tableau', 'Salesforce'], ['Power BI', 'Microsoft'], ['Figma', 'Figma'],
    ['Miro', 'Miro'], ['Notion', 'Notion'], ['Asana', 'Asana'], ['Monday.com', 'monday'],
    ['Visma Lön', 'Visma'], ['Fortnox', 'Fortnox'], ['Coupa', 'Coupa'], ['Concur', 'SAP'],
    ['Greenhouse', 'Greenhouse'], ['BambooHR', 'BambooHR'], ['Personio', 'Personio'], ['Lattice', 'Lattice'],
    ['1Password', 'AgileBits'], ['CrowdStrike Falcon', 'CrowdStrike'], ['Intune', 'Microsoft'], ['Jamf Pro', 'Jamf'],
    ['Veeam backup', 'Veeam'], ['NetApp filers', 'NetApp'], ['VMware cluster', 'Broadcom'], ['Citrix VDI', 'Cloud Software'],
    ['Oracle EBS', 'Oracle'], ['Dynamics 365', 'Microsoft'], ['Mailchimp', 'Intuit'], ['Contentful', 'Contentful'],
    ['Customer portal', null], ['Order service', null], ['Billing engine', null], ['Data warehouse', null],
    ['Payroll integration', null], ['Partner API gateway', null], ['Mobile app backend', null], ['Pricing service', null],
    ['Identity broker', null], ['Document archive', null], ['Ticket bridge', null], ['Reporting hub', null],
    ['Kubernetes platform', null], ['CI runners', null], ['Artifact registry', null], ['Feature flags', 'LaunchDarkly'],
    ['Sentry', 'Functional Software'], ['PagerDuty', 'PagerDuty'], ['Statuspage', 'Atlassian'], ['Cloudflare', 'Cloudflare'],
    ['Twilio', 'Twilio'], ['SendGrid', 'Twilio'], ['Stripe', 'Stripe'], ['Adyen', 'Adyen'],
    ['Klarna checkout', 'Klarna'], ['Bankgirot file transfer', 'Bankgirot'], ['Swish integration', 'Getswish'], ['BankID', 'Finansiell ID-Teknik'],
    ['Intranet', null], ['Warehouse scanners', null], ['Badge access', 'Axis'], ['CCTV recorder', 'Milestone'],
    ['Print fleet', 'Canon'], ['Meeting rooms', 'Crestron'], ['Phone switch', 'Telavox'], ['Wi-Fi controllers', 'Cisco'],
    ['Legal hold', 'Relativity'], ['Contract register', null], ['Board portal', 'Diligent'], ['Whistleblower line', 'WhistleB'],
    ['Learning platform', 'Docebo'], ['Survey tool', 'Qualtrics'], ['Translation memory', 'Phrase'], ['Chat widget', 'Intercom'],
    ['Analytics', 'Google'], ['Tag manager', 'Google'], ['Ad accounts', 'Meta'], ['Brand assets', 'Bynder'],
    ['ML feature store', null], ['Forecasting model', null], ['Fraud scoring', null], ['Search cluster', 'Elastic'],
    ['Message bus', null], ['Event store', null], ['Legacy CRM', null], ['Mainframe batch', 'IBM'],
    ['FTP drop zone', null], ['Expense cards', 'Pleo'], ['Travel booking', 'Navan'], ['Fleet tracking', 'Samsara'],
    ['Lab LIMS', 'LabWare'], ['QMS', 'Veeva'], ['PLM', 'PTC'], ['CAD vault', 'Autodesk'],
    ['GIS server', 'Esri'], ['Energy metering', null], ['Building BMS', 'Siemens'], ['Visitor log', 'Envoy']
  ];

  const now = new Date('2026-10-16T09:00:00');
  const systems = NAMES.map(([name, vendor], i) => {
    const r = rnd();
    const status = r < 0.18 ? 'DRAFT' : r < 0.36 ? 'IN_REVIEW' : r < 0.5 ? 'APPROVED' : r < 0.94 ? 'ONBOARDED' : 'REJECTED';
    const facets = vendor && rnd() < 0.7 ? ['S'] : rnd() < 0.5 ? ['C'] : rnd() < 0.6 ? ['O'] : ['C', 'O'];
    const lvl = () => LEVELS[Math.floor(rnd() * 5)];
    const units = [pick(UNITS)];
    if (rnd() < 0.3) units.push(pick(UNITS.filter((u) => u !== units[0])));
    const total = 18 + Math.floor(rnd() * 46);
    const doneShare = status === 'ONBOARDED' ? 0.85 + rnd() * 0.15 : status === 'APPROVED' ? 0.7 + rnd() * 0.25 : status === 'IN_REVIEW' ? 0.35 + rnd() * 0.45 : status === 'DRAFT' ? rnd() * 0.3 : 0.2 + rnd() * 0.4;
    const daysAgo = Math.floor(rnd() * rnd() * 220);
    return {
      id: 'sys-' + (i + 1),
      name, vendor,
      status,
      owner: pick(OWNERS),
      facets,
      c: lvl(), i: lvl(), a: lvl(),
      units,
      provider: /Entra|landing zone|AWS Org|Kubernetes|Veeam|Okta|Identity broker|Cloudflare/.test(name),
      questions: status === 'IN_REVIEW' || status === 'DRAFT' ? (rnd() < 0.45 ? 1 + Math.floor(rnd() * 5) : 0) : (rnd() < 0.08 ? 1 : 0),
      controls: total,
      fulfilled: Math.round(total * doneShare),
      risks: Math.floor(rnd() * rnd() * 6),
      updated: new Date(now.getTime() - daysAgo * 864e5)
    };
  });

  const fmtAgo = (d) => {
    const days = Math.round((now - d) / 864e5);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' d ago';
    if (days < 365) return Math.round(days / 30) + ' mo ago';
    return Math.round(days / 365) + ' y ago';
  };
  const initials = (n) => n.split(' ').map((p) => p[0]).join('').slice(0, 2);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const statusOf = (k) => STATUSES.find((s) => s.key === k);
  const facetOf = (k) => FACETS.find((f) => f.key === k);

  window.SYS = { systems, STATUSES, FACETS, UNITS, OWNERS, LEVELS, fmtAgo, initials, esc, statusOf, facetOf, now };
})();

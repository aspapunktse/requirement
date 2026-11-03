/* Example data for the Information Type proposals (#302). Illustrative only. Terms follow CONTEXT.md.
   A type carries one Sensitivity Level (1 Public ... 5 Critical Sensitivity) and nothing else: no Frameworks (#300).
   A System declares any number of types; its own level may not sit below the highest of them. Two Systems below are
   flagged "below its Information Types" because a curator raised a type's level after the owner declared it. */
(function (g) {
  const TYPES = [
    { id: 't1', name: 'Published marketing content', level: 1, desc: 'Web pages, brochures and press releases that are already public.' },
    { id: 't2', name: 'Internal documentation', level: 2, desc: 'Wiki pages, meeting notes, intranet posts and organisation charts meant for staff.' },
    { id: 't3', name: 'Source code', level: 3, desc: 'Application and infrastructure code, build scripts and repository history.' },
    { id: 't4', name: 'Customer personal data', level: 3, desc: 'Names, contact details and account data of customers and their staff.' },
    { id: 't5', name: 'Customer contracts and prices', level: 3, desc: 'Agreements, quotes, discounts and payment terms.' },
    { id: 't6', name: 'Payroll', level: 4, desc: 'Salaries, bonuses, tax and bank details for paying employees.' },
    { id: 't7', name: 'Employee health data', level: 4, desc: 'Sick leave reasons, occupational health notes and rehabilitation plans.' },
    { id: 't8', name: 'Credentials and encryption keys', level: 5, desc: 'Passwords, API keys, certificates and master keys that protect other Systems.' },
    { id: 't9', name: 'Export-controlled technical data', level: 5, desc: 'Design data and drawings that export-control law restricts.' },
    { id: 't11', name: 'Supplier invoices', level: 2, desc: 'Invoices and payment details received from suppliers. No System declares it yet.' },
    { id: 't10', name: 'Product design data', level: 4, desc: 'CAD models, bills of materials and engineering change notes.' },
  ];

  // level: 1-5 or null (not declared yet); types: ids the owner declared; kind: System or Provider
  const SYSTEMS = [
    { id: 's1', name: 'Marketing website', vendor: 'Contentful', owner: 'Hanna Ek', status: 'ONBOARDED', level: 1, types: ['t1'], kind: 'System' },
    { id: 's2', name: 'Unily', vendor: 'Unily', owner: 'Priya Shah', status: 'ONBOARDED', level: 2, types: ['t2'], kind: 'System' },
    { id: 's3', name: 'Jira', vendor: 'Atlassian', owner: 'Jonas Berg', status: 'ONBOARDED', level: 3, types: ['t2', 't3'], kind: 'System' },
    { id: 's4', name: 'GitHub', vendor: 'GitHub', owner: 'Jonas Berg', status: 'APPROVED', level: 3, types: ['t3'], kind: 'System' },
    { id: 's5', name: 'Salesforce', vendor: 'Salesforce', owner: 'Lucas Ortega', status: 'IN_REVIEW', level: 3, types: ['t4', 't5'], kind: 'System' },
    { id: 's6', name: 'Microsoft 365', vendor: 'Microsoft', owner: 'Marcus Lindqvist', status: 'APPROVED', level: 3, types: ['t2', 't4', 't7'], kind: 'System' },
    { id: 's7', name: 'Payroll integration', vendor: '', owner: 'Marcus Lindqvist', status: 'DRAFT', level: 3, types: ['t6'], kind: 'System' },
    { id: 's8', name: 'Workday', vendor: 'Workday', owner: 'Sofia Nilsson', status: 'ONBOARDED', level: 4, types: ['t6', 't7'], kind: 'System' },
    { id: 's9', name: 'Data warehouse', vendor: '', owner: 'Marcus Lindqvist', status: 'APPROVED', level: 4, types: ['t4'], kind: 'System' },
    { id: 's10', name: 'CATIA', vendor: 'Dassault Systèmes', owner: 'Kenji Mori', status: 'ONBOARDED', level: 5, types: ['t9', 't10'], kind: 'System' },
    { id: 's11', name: 'Entra ID SSO', vendor: 'Microsoft', owner: 'Amira Haddad', status: 'APPROVED', level: 5, types: ['t8'], kind: 'Provider' },
    { id: 's12', name: 'Figma', vendor: 'Figma', owner: 'Hanna Ek', status: 'DRAFT', level: 2, types: [], kind: 'System' },
    { id: 's13', name: 'Notion', vendor: 'Notion', owner: 'David Okafor', status: 'DRAFT', level: null, types: [], kind: 'System' },
  ];
  const STATUS = { DRAFT: ['Draft', ''], IN_REVIEW: ['In review', 'warn'], APPROVED: ['Approved', 'success'], ONBOARDED: ['Onboarded', 'done'] };
  // The people acting: the System Owner in the header is Marcus Lindqvist, who owns three of the sample Systems.
  g.ITData = { TYPES, SYSTEMS, STATUS, ME: 'Marcus Lindqvist' };
})(typeof window !== 'undefined' ? window : globalThis);

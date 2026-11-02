/* Example data for the Sensitivity Level proposals (#289). Illustrative only: the five levels with the
   default colours from the issue, a dozen Systems and a dozen Controls. Terms follow CONTEXT.md. */
(function (g) {
  const LEVELS = [
    { n: 1, label: 'Public', family: 'Gray', fg: '#475569', bg: '#F1F5F9',
      desc: 'Information anyone may see. Publishing it harms nobody.',
      examples: ['Published product pages', 'Press releases', 'Open-source code'] },
    { n: 2, label: 'Internal', family: 'Blue', fg: '#1D4ED8', bg: '#EFF6FF',
      desc: 'Everyday business information meant for staff, not for the public.',
      examples: ['Internal wiki', 'Meeting notes', 'Organisation charts'] },
    { n: 3, label: 'Sensitive', family: 'Yellow', fg: '#854D0E', bg: '#FEF9C3',
      desc: 'Information that would cause harm or embarrassment if it leaked.',
      examples: ['Customer contact lists', 'Contracts and prices', 'Financial forecasts'] },
    { n: 4, label: 'Highly Sensitive', family: 'Orange', fg: '#9A3412', bg: '#FFEDD5',
      desc: 'Information whose leak would seriously harm people or the business, or break the law.',
      examples: ['Personal data of customers', 'Payroll and HR files', 'Credentials and secrets'] },
    { n: 5, label: 'Critical Sensitivity', family: 'Red', fg: '#991B1B', bg: '#FEE2E2',
      desc: 'Information whose leak or loss would threaten the organisation itself.',
      examples: ['Encryption master keys', 'Health records', 'Trade secrets'] },
  ];

  // level: 1-5, or null for a System whose owner has not declared one yet
  const SYSTEMS = [
    { id: 's1', name: 'Marketing website', vendor: 'Contentful', owner: 'Hanna Ek', status: 'ONBOARDED', level: 1 },
    { id: 's2', name: 'Confluence', vendor: 'Atlassian', owner: 'Priya Shah', status: 'ONBOARDED', level: 2 },
    { id: 's3', name: 'Slack', vendor: 'Salesforce', owner: 'Jonas Berg', status: 'APPROVED', level: 2 },
    { id: 's4', name: 'Salesforce', vendor: 'Salesforce', owner: 'Lucas Ortega', status: 'IN_REVIEW', level: 3 },
    { id: 's5', name: 'Customer portal', vendor: '', owner: 'Elena Voss', status: 'IN_REVIEW', level: 3 },
    { id: 's6', name: 'Workday', vendor: 'Workday', owner: 'Sofia Nilsson', status: 'ONBOARDED', level: 4 },
    { id: 's7', name: 'Data warehouse', vendor: '', owner: 'Marcus Lindqvist', status: 'APPROVED', level: 4 },
    { id: 's8', name: 'Payroll integration', vendor: '', owner: 'Sofia Nilsson', status: 'DRAFT', level: 4 },
    { id: 's9', name: 'Billing engine', vendor: '', owner: 'Kenji Mori', status: 'IN_REVIEW', level: 4 },
    { id: 's10', name: 'Okta', vendor: 'Okta', owner: 'Amira Haddad', status: 'ONBOARDED', level: 5 },
    { id: 's11', name: 'Key vault', vendor: 'HashiCorp', owner: 'Amira Haddad', status: 'APPROVED', level: 5 },
    { id: 's12', name: 'Notion', vendor: 'Notion', owner: 'David Okafor', status: 'DRAFT', level: null },
    { id: 's13', name: 'Figma', vendor: 'Figma', owner: 'Hanna Ek', status: 'DRAFT', level: null },
  ];
  const STATUS = {
    DRAFT: ['Draft', ''], IN_REVIEW: ['In review', 'warn'], APPROVED: ['Approved', 'success'], ONBOARDED: ['Onboarded', 'done'],
  };

  // min: the Control's minimum Sensitivity Level (null = applies at every level)
  const CONTROLS = [
    { id: 'A.5.15', name: 'Access control', min: null, scope: 'Per System', text: 'Rules to control physical and logical access to information are established and implemented.' },
    { id: 'A.8.13', name: 'Information backup', min: null, scope: 'Per System', text: 'Backups of information, software and systems are kept and tested.' },
    { id: 'A.5.14', name: 'Information transfer', min: 2, scope: 'Per System', text: 'Transfer rules and agreements cover all kinds of transfer facilities.' },
    { id: 'A.8.10', name: 'Information deletion', min: 2, scope: 'Per System', text: 'Information is deleted when it is no longer required.' },
    { id: 'A.8.24', name: 'Use of cryptography', min: 3, scope: 'Per System', text: 'Rules for the effective use of cryptography, including key management, are defined and implemented.' },
    { id: 'A.5.34', name: 'Privacy and protection of personal data', min: 3, scope: 'Per System', text: 'The organisation identifies and meets its requirements on protecting personal data.' },
    { id: 'A.8.5', name: 'Step-up authentication', min: 4, scope: 'Per System', text: 'Secure authentication is required again for sensitive actions, such as exporting records or changing roles.' },
    { id: 'A.8.12', name: 'Data leakage prevention', min: 4, scope: 'Per System', text: 'Data leakage prevention measures apply to systems that process or store sensitive information.' },
    { id: 'A.8.11', name: 'Data masking', min: 4, scope: 'Per System', text: 'Data is masked in line with access control and business requirements.' },
    { id: 'A.8.9', name: 'Configuration review', min: 4, scope: 'Both', text: 'Configurations are reviewed at planned intervals and after significant change.' },
    { id: 'LIB-031', name: 'Hardware-backed key custody', min: 5, scope: 'Per System', text: 'Keys that protect this System are held in a hardware security module under dual control.' },
    { id: 'A.5.20', name: 'Supplier agreements', min: null, scope: 'Organizational', text: 'Information security requirements are agreed with each supplier.' },
  ];
  g.SensData = { LEVELS, SYSTEMS, STATUS, CONTROLS };
})(typeof window !== 'undefined' ? window : globalThis);

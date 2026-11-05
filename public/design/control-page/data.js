/* Example data for the Control page proposals (#314). Illustrative only. Terms follow CONTEXT.md.
   The Control records themselves come from ../controls/data.js (window.CONTROLS). This file adds what that list lacks:
   the Frameworks (one is a Draft), per-Requirement mappings with Full or Partial Coverage, the intent and examples,
   the Organization Control Implementation (status, description, last updated), the Sensitivity Level a Control starts at,
   and a small set of Systems with an owner and a Business Unit so a role can be shown only some of them.

   A Control applies to a System when the Control is Per-System or Both and the System meets its scoping: a Deployment
   Facet in common (or the Control has none), and a Sensitivity Level and Integrity and Availability Impact Levels at or
   above the Control's minimums (a System with no level declared is not matched by a Sensitivity minimum).
   The effective status of a Control on a System is made up here, but follows the rules: a Both Control whose
   Organization implementation is Fulfilled is inherited by the System unless the System's owner set their own status. */
(function (g) {
  const FRAMEWORKS = [
    { id: 'iso', name: 'ISO 27001:2022', draft: false, base: true },
    { id: 'ccm', name: 'CSA CCM 4.1.1', draft: false },
    { id: 'nis2', name: 'NIS2 Directive', draft: false },
    { id: 'cmmc', name: 'CMMC 2.0 Level 2', draft: true },
  ];
  // Maps the data.js framework names to ids
  const FW_BY_NAME = { 'ISO 27001:2022': 'iso', 'CSA CCM 4.1.1': 'ccm' };

  const SENS = ['Public', 'Internal', 'Sensitive', 'Highly Sensitive', 'Critical Sensitivity'];
  // data.js still holds the old Confidentiality thresholds; a Control now starts at a Sensitivity Level
  const SENS_FROM_C = { LOW: 2, MODERATE: 3, HIGH: 4, CRITICAL: 5 };
  const IMPACT = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };
  const IMPACT_LABEL = { LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High', CRITICAL: 'Critical' };

  const STATUS = {
    FULFILLED: { label: 'Fulfilled', tone: 'success' },
    IN_PROGRESS: { label: 'In progress', tone: 'warn' },
    NOT_STARTED: { label: 'Not started', tone: 'neutral' },
    NOT_APPLICABLE: { label: 'Not applicable', tone: 'plain' },
    WAIVED: { label: 'Waived', tone: 'plain' },
  };
  const FROM_LIST_STATUS = { IMPLEMENTED: 'FULFILLED', IN_PROGRESS: 'IN_PROGRESS', NOT_STARTED: 'NOT_STARTED' };

  // Requirements per Control: [framework id, requirement code, title, 'FULL' | 'PARTIAL']
  const R = {
    'A.5.1': [
      ['iso', 'A.5.1', 'Policies for information security', 'FULL'],
      ['iso', '5.2', 'Information security policy', 'PARTIAL'],
      ['ccm', 'GRC-01', 'Governance Program Policy and Procedures', 'FULL'],
      ['ccm', 'GRC-03', 'Organizational Policy Reviews', 'PARTIAL'],
      ['nis2', 'Art. 21(2)(a)', 'Policies on risk analysis and information system security', 'FULL'],
      ['cmmc', 'CA.L2-3.12.4', 'System security plan', 'PARTIAL'],
    ],
    'A.5.3': [
      ['iso', 'A.5.3', 'Segregation of duties', 'FULL'],
      ['ccm', 'IAM-05', 'Least Privilege', 'PARTIAL'],
      ['ccm', 'IAM-04', 'Separation of Duties', 'FULL'],
      ['nis2', 'Art. 21(2)(i)', 'Human resources security, access control policies and asset management', 'PARTIAL'],
      ['cmmc', 'AC.L2-3.1.4', 'Separation of duties', 'FULL'],
    ],
    'A.5.17': [
      ['iso', 'A.5.17', 'Authentication information', 'FULL'],
      ['ccm', 'IAM-14', 'Strong Authentication', 'FULL'],
      ['ccm', 'IAM-15', 'Passwords Management', 'FULL'],
      ['nis2', 'Art. 21(2)(j)', 'Multi-factor authentication or continuous authentication solutions', 'PARTIAL'],
    ],
    'A.8.5': [
      ['iso', 'A.8.5', 'Secure authentication', 'FULL'],
      ['ccm', 'IAM-14', 'Strong Authentication', 'PARTIAL'],
      ['nis2', 'Art. 21(2)(j)', 'Multi-factor authentication or continuous authentication solutions', 'FULL'],
      ['cmmc', 'IA.L2-3.5.3', 'Multifactor authentication', 'FULL'],
    ],
    'CCM-SUP-01': [
      ['ccm', 'IVS-09', 'Network Defense', 'PARTIAL'],
      ['ccm', 'DSP-17', 'Sensitive Data Protection', 'PARTIAL'],
      ['ccm', 'CCC-01', 'Tenant segmentation and isolation (provider obligation)', 'FULL'],
    ],
    'CCM-SUP-04': [
      ['ccm', 'IPY-04', 'Data Portability Contractual Obligations', 'FULL'],
      ['ccm', 'IPY-03', 'Secure Interoperability and Portability Management', 'PARTIAL'],
    ],
    'CCM-SUP-18': [
      ['ccm', 'AIS-07', 'Application Vulnerability Remediation', 'PARTIAL'],
      ['ccm', 'AIS-05', 'Automated Application Security Testing', 'FULL'],
      ['nis2', 'Art. 21(2)(e)', 'Security in network and information systems acquisition, development and maintenance', 'FULL'],
    ],
    // Not mapped to any Requirement
    'CCM-SUP-15': [],
    // A Supplementary Control whose origin is a Draft Framework (CMMC 2.0 Level 2 is still a Draft)
    'CMMC-L2-SUP-01': [
      ['cmmc', 'MP.L2-3.8.4', 'Media markings', 'FULL'],
      ['cmmc', 'AC.L2-3.1.22', 'Control public information', 'PARTIAL'],
    ],
  };

  // What the list in data.js lacks: intent, examples, and overrides where an example needs a different case
  const X = {
    'A.5.1': {
      intent: 'Give everyone one authoritative statement of what the organization expects of them on information security, and keep it current.',
      examples: ['An information security policy approved by management and published on the intranet', 'Topic-specific policies (access control, backup, cryptography) reviewed every year', 'A review log showing who approved each version and when'],
      org: { status: 'IN_PROGRESS', description: 'The policy set is drafted and approved by management. The topic-specific policies for backup and cryptography are still being reviewed; the intranet publication follows once the CISO signs them off.', updated: '2026-10-21', by: 'Jonas Berg' },
    },
    'A.5.3': {
      intent: 'Make sure no single person can start, approve and complete a sensitive action alone, so a mistake or abuse is caught by someone else.',
      examples: ['A change needs a second reviewer before it is merged', 'Whoever requests access is never the one who approves it', 'Payments above a limit need two approvers'],
      org: { status: 'FULFILLED', description: 'Duties are separated through the Change Management Standard and the access approval workflow. Exceptions need the CISO’s written approval and are listed in the quarterly review.', updated: '2026-09-30', by: 'Lucas Ortega' },
    },
    'A.5.17': {
      intent: 'Treat passwords, keys and tokens as secrets throughout their life: issue them securely, never share them, and change them when they may be exposed.',
      examples: ['Initial passwords are random, single-use and sent through a separate channel', 'A password manager is the only place shared credentials are kept', 'Service account keys rotate on a schedule and on staff departure'],
      org: { status: 'NOT_STARTED', description: '', updated: null, by: null },
    },
    'A.8.5': {
      intent: 'Check who someone is before giving access, with a method as strong as the information behind it.',
      examples: ['Multi-factor authentication for every user of the System', 'Single sign-on through Entra ID where the System supports it', 'Lockout and alerting after repeated failed sign-ins'],
    },
    'CCM-SUP-01': {
      intent: 'A cloud provider keeps each customer’s data and access apart from every other customer’s, and proves it.',
      examples: ['Per-tenant encryption keys and separate storage namespaces', 'Cross-tenant access blocked by default and logged when an operator needs it', 'Annual penetration test that includes tenant-escape scenarios'],
    },
    'CCM-SUP-04': {
      intent: 'Customers can take their data and leave, in a format they can use, without being locked in.',
      examples: ['Export of all customer data in an open format on request', 'A documented exit plan with timings', 'Contract terms that name the data returned and when it is deleted'],
      mandatory: false,
    },
    'CCM-SUP-18': {
      intent: 'Releases reach production only after they have been built, tested and approved in a repeatable pipeline.',
      examples: ['Signed builds from a protected branch', 'Automated tests and security scans gate the deploy', 'Rollback tested for every release'],
      org: { status: 'FULFILLED', description: 'One shared delivery pipeline template is used by all engineering teams. It enforces review, tests and scanning before a deploy, and every release is traceable to a ticket.', updated: '2026-10-08', by: 'Elena Voss' },
    },
    'CCM-SUP-15': {
      intent: 'Track a few numbers about the application’s security so trends are noticed before they become incidents.',
      examples: ['Time to fix a critical vulnerability', 'Share of builds that pass the security scan first time'],
    },
  };

  // Extra Controls the list does not hold: a Supplementary Control authored for a Framework that is still a Draft
  const EXTRA_CONTROLS = [
    { code: 'CMMC-L2-SUP-01', title: 'Marking of media that holds controlled information', description: 'Mark removable and printed media that holds Controlled Unclassified Information with its handling caveats and distribution limits.',
      category: 'CMMC media protection', applicability: 'PER_SYSTEM', mandatory: true, question: 'Is every disk, tape or printout that holds controlled information in this System marked with how it may be handled and who may receive it?',
      origin: 'CMMC 2.0 Level 2', facets: ['On-Premises Datacenter'], c: 'HIGH', i: null, a: null, owner: 'Priya Shah', status: null, systems: 0, maps: [], intent: 'Anyone picking up a disk or printout can tell at once how careful they must be with it.',
      examples: ['A label on every backup tape with the handling caveat', 'Printed reports carry a header and footer marking'] },
  ];

  // Systems. level = Sensitivity Level 1..5 (null: not declared), ii / aa = Integrity and Availability Impact Levels 1..4.
  const SYSTEMS = [
    { id: 's1', name: 'Marketing website', owner: 'Hanna Ek', bu: 'Marketing', facets: ['SaaS'], level: 1, ii: 1, aa: 2 },
    { id: 's2', name: 'Unily', owner: 'Priya Shah', bu: 'People', facets: ['SaaS'], level: 2, ii: 1, aa: 2 },
    { id: 's3', name: 'Jira', owner: 'Jonas Berg', bu: 'Engineering', facets: ['SaaS'], level: 3, ii: 2, aa: 2 },
    { id: 's4', name: 'GitHub', owner: 'Jonas Berg', bu: 'Engineering', facets: ['SaaS', 'Cloud IaaS/PaaS'], level: 3, ii: 3, aa: 3 },
    { id: 's5', name: 'Salesforce', owner: 'Lucas Ortega', bu: 'Sales', facets: ['SaaS'], level: 3, ii: 2, aa: 3 },
    { id: 's6', name: 'Microsoft 365', owner: 'Marcus Lindqvist', bu: 'IT', facets: ['SaaS'], level: 3, ii: 3, aa: 3 },
    { id: 's7', name: 'Payroll integration', owner: 'Marcus Lindqvist', bu: 'Finance & HR', facets: ['Cloud IaaS/PaaS'], level: 4, ii: 3, aa: 2 },
    { id: 's8', name: 'Workday', owner: 'Sofia Nilsson', bu: 'Finance & HR', facets: ['SaaS'], level: 4, ii: 3, aa: 3 },
    { id: 's9', name: 'Data warehouse', owner: 'Marcus Lindqvist', bu: 'Data', facets: ['Cloud IaaS/PaaS'], level: 4, ii: 3, aa: 2 },
    { id: 's10', name: 'CATIA', owner: 'Kenji Mori', bu: 'R&D', facets: ['On-Premises Datacenter'], level: 5, ii: 4, aa: 3 },
    { id: 's11', name: 'Entra ID SSO', owner: 'Amira Haddad', bu: 'IT', facets: ['SaaS'], level: 5, ii: 4, aa: 4 },
    { id: 's12', name: 'Figma', owner: 'Hanna Ek', bu: 'Marketing', facets: ['SaaS'], level: 2, ii: 1, aa: 1 },
    { id: 's13', name: 'Notion', owner: 'David Okafor', bu: 'Product', facets: ['SaaS'], level: null, ii: 1, aa: 1 },
    { id: 's14', name: 'Build farm', owner: 'Jonas Berg', bu: 'Engineering', facets: ['On-Premises Datacenter', 'Cloud IaaS/PaaS'], level: 3, ii: 3, aa: 3 },
    { id: 's15', name: 'Customer portal', owner: 'Lucas Ortega', bu: 'Sales', facets: ['SaaS', 'Cloud IaaS/PaaS'], level: 4, ii: 3, aa: 4 },
    { id: 's16', name: 'Backup vault', owner: 'Marcus Lindqvist', bu: 'IT', facets: ['On-Premises Datacenter'], level: 5, ii: 4, aa: 3 },
  ];

  // Who sees which Systems. Reviewer, Risk Owner, Compliance Manager and Admin see every System; a System Owner sees the
  // Systems they own; a Business Risk Owner sees the Business Units in their portfolio (Finance & HR and Sales here).
  const ME = 'Marcus Lindqvist';
  const PORTFOLIO = ['Finance & HR', 'Sales'];

  // The Control codes the picker offers, in the order a reviewer should look at them
  const EXAMPLES = [
    ['A.5.1', 'Organizational, base Control'],
    ['A.5.3', 'Both, applies to every System'],
    ['A.5.17', 'Both, with Sensitivity and Integrity minimums, no Control Owner'],
    ['A.8.5', 'Per-System, Sensitivity "From Critical Sensitivity"'],
    ['CCM-SUP-01', 'Supplementary, Per-System, no Control Owner'],
    ['CCM-SUP-04', 'Supplementary, Not mandatory'],
    ['CCM-SUP-18', 'Supplementary, Both'],
    ['CMMC-L2-SUP-01', 'Supplementary from a Draft Framework'],
    ['CCM-SUP-15', 'Not mapped to any Requirement'],
  ];

  g.CPData = { FRAMEWORKS, FW_BY_NAME, SENS, SENS_FROM_C, IMPACT, IMPACT_LABEL, STATUS, FROM_LIST_STATUS, R, X, EXTRA_CONTROLS, SYSTEMS, ME, PORTFOLIO, EXAMPLES };
})(window);

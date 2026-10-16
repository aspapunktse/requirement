/* Shared example data + applicability engine for both onboarding proposals.
   Mirrors the domain model: a Control applies when a Framework that maps to it is in the
   System's scope (ISO 27001 always is), AND its Deployment Facet scoping matches, AND its
   Impact Level thresholds are met. Providers change who implements it, never whether it applies.
   All IDs, mappings and texts are illustrative example data. */
(function () {
  const LEVELS = ['Not classified', 'Low', 'Moderate', 'High', 'Critical'];

  const FRAMEWORKS = {
    iso: 'ISO/IEC 27001:2022',
    ccm: 'CSA Cloud Controls Matrix 4.1',
    gdpr: 'GDPR',
    csl: 'Cybersäkerhetslagen (2025:1506)'
  };

  const DOMAINS = [
    ['GOV', 'Ownership & governance'],
    ['ACC', 'Sign-in & access'],
    ['DAT', 'Data protection'],
    ['SUP', 'Vendor & cloud service'],
    ['OPS', 'Operations & change'],
    ['LOG', 'Logging & monitoring'],
    ['RES', 'Backup & continuity'],
    ['PHY', 'Hardware & premises'],
    ['PRV', 'Personal data'],
    ['INC', 'Incidents & reporting']
  ];

  const PROVIDERS = {
    entra: { name: 'Company sign-in (Entra ID)', short: 'Entra ID' },
    lz: { name: 'Azure landing zone', short: 'Landing zone' },
    soc: { name: 'Security operations centre', short: 'SOC' },
    bkp: { name: 'Central backup service', short: 'Backup service' }
  };

  // f = facets (S SaaS, I IaaS/PaaS, O on-prem; empty = any), c/i/a = minimum level (1-4)
  // fw = frameworks whose requirements map here; ref = requirement refs per framework
  // inh = inheritance: {org:'full'|'shared'} or {p:providerKey, t:'full'|'shared', r:customer responsibility}
  const C = [
    // Ownership & governance
    { id: 'GOV-01', t: 'Named owner and deputy', d: 'Record who answers for the system and who stands in when they are away.', ev: 'Owner and deputy recorded on the system.', cad: 'Annual', fw: ['iso'], ref: { iso: ['A.5.2'] } },
    { id: 'GOV-02', t: 'Company security policies apply', d: 'The system follows the company information security policy set.', ev: 'Nothing from you: the policy owner maintains it.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.1'], ccm: ['GRC-05'] }, inh: { org: 'full' } },
    { id: 'GOV-03', t: 'Listed in the asset inventory', d: 'Keep the system, its data and its integrations listed and current.', ev: 'Inventory entry with data types and integrations.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.9'], ccm: ['DSP-03'] } },
    { id: 'GOV-04', t: 'Risk assessment of the system', d: 'Identify what could go wrong with the system and decide how each risk is handled.', ev: 'Completed risk assessment with treatment decisions.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['6.1.2'], ccm: ['GRC-02'] } },
    { id: 'GOV-05', t: 'Legal and contract obligations listed', d: 'List the laws, regulations and customer contracts the system must meet.', ev: 'Obligations list linked to the system.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.31'], ccm: ['GRC-07'] } },
    { id: 'GOV-06', t: 'Security built into the project', d: 'Security requirements are part of the project plan from the start.', ev: 'Project plan or backlog items covering security.', cad: 'Per change', fw: ['iso', 'ccm'], ref: { iso: ['A.5.8'], ccm: ['AIS-01'] }, c: 2 },

    // Sign-in & access
    { id: 'ACC-01', t: 'Single sign-on with company accounts', d: 'Users sign in with their company account, never a local password.', ev: 'SSO configuration screenshot or export.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.16', 'A.8.5'], ccm: ['IAM-16'] }, inh: { p: 'entra', t: 'shared', r: 'Connect the system to Entra ID and turn off local sign-in.' } },
    { id: 'ACC-02', t: 'Multi-factor sign-in', d: 'Every sign-in requires a second factor.', ev: 'Conditional access policy covering the system.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.5'], ccm: ['IAM-14'] }, c: 2, inh: { p: 'entra', t: 'full' } },
    { id: 'ACC-03', t: 'Access follows joiners, movers and leavers', d: 'Access is granted through groups and removed automatically when people leave.', ev: 'Role-to-group mapping.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.18'], ccm: ['IAM-07'] }, inh: { p: 'entra', t: 'shared', r: 'Map each system role to an Entra ID group.' } },
    { id: 'ACC-04', t: 'Access review', d: 'Check who has access and remove what is no longer needed.', ev: 'Signed-off review of users and roles.', cad: 'Semi-annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.18'], ccm: ['IAM-08'] }, c: 2 },
    { id: 'ACC-05', t: 'Separate admin accounts', d: 'Administrators use a separate account for admin work.', ev: 'List of admin accounts and their owners.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.2'], ccm: ['IAM-09'] }, i: 2 },
    { id: 'ACC-06', t: 'Just-in-time admin access', d: 'Admin rights are requested, approved and time-limited.', ev: 'Privileged access configuration and a sample approval.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.2'], ccm: ['IAM-10'] }, c: 3, inh: { p: 'entra', t: 'shared', r: 'Put the system admin roles under Entra PIM.' } },
    { id: 'ACC-07', t: 'Break-glass account', d: 'An emergency account exists, is sealed and is tested.', ev: 'Break-glass test record.', cad: 'Annual', fw: ['iso'], ref: { iso: ['A.8.2'] }, a: 3 },
    { id: 'ACC-08', t: 'API keys and service accounts rotated', d: 'Integration secrets have an owner and are rotated on schedule.', ev: 'Secret inventory with rotation dates.', cad: 'Quarterly', fw: ['iso', 'ccm'], ref: { iso: ['A.5.17'], ccm: ['IAM-15'] }, f: ['S', 'I'] },

    // Data protection
    { id: 'DAT-01', t: 'Data classified', d: 'Label the information the system holds with the company classification.', ev: 'Classification recorded on the system.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.12'], ccm: ['DSP-04'] } },
    { id: 'DAT-02', t: 'Encrypted in transit', d: 'All traffic to and from the system uses current TLS.', ev: 'TLS scan result.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.24'], ccm: ['CEK-03'] }, c: 2 },
    { id: 'DAT-03', t: 'Encrypted at rest', d: 'Stored data and backups are encrypted.', ev: 'Storage encryption setting or vendor statement.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.24'], ccm: ['CEK-03'] }, c: 2, inh: { p: 'lz', t: 'full' } },
    { id: 'DAT-04', t: 'Company-held encryption keys', d: 'The company controls the keys, so the vendor cannot read the data alone.', ev: 'Key vault reference and key rotation record.', cad: 'Annual', fw: ['ccm'], ref: { ccm: ['CEK-08', 'CEK-10'] }, f: ['S', 'I'], c: 3, supp: 'ccm' },
    { id: 'DAT-05', t: 'Data stays in the EU', d: 'Know and approve the countries where data is stored and processed.', ev: 'Vendor data-location statement.', cad: 'Annual', fw: ['ccm', 'gdpr'], ref: { ccm: ['DSP-19'], gdpr: ['Art. 44'] }, f: ['S', 'I'], supp: 'ccm' },
    { id: 'DAT-06', t: 'Data deleted at end of use', d: 'Data is deleted, and the deletion confirmed, when the system or contract ends.', ev: 'Deletion procedure or vendor deletion certificate.', cad: 'At exit', fw: ['iso', 'ccm'], ref: { iso: ['A.8.10'], ccm: ['DSP-02'] } },
    { id: 'DAT-07', t: 'Leakage of sensitive data blocked', d: 'Sensitivity labels and DLP rules stop data leaving by mistake.', ev: 'DLP policy covering the system.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.12'], ccm: ['DSP-17'] }, c: 3 },
    { id: 'DAT-08', t: 'No production data in test', d: 'Test environments use synthetic or masked data.', ev: 'Test data description.', cad: 'Per change', fw: ['iso'], ref: { iso: ['A.8.33'] }, c: 2, f: ['I', 'O'] },

    // Vendor & cloud service
    { id: 'SUP-01', t: 'Vendor security review before signing', d: 'Assess the vendor before the contract is signed.', ev: 'Completed vendor questionnaire and decision.', cad: 'Before contract', fw: ['iso', 'ccm'], ref: { iso: ['A.5.19', 'A.5.21'], ccm: ['STA-08', 'STA-14'] }, f: ['S'] },
    { id: 'SUP-02', t: 'Vendor certification checked', d: 'Read the vendor’s ISO certificate, SOC 2 report or CSA STAR entry and note any exceptions.', ev: 'Current attestation and reviewer notes.', cad: 'Annual', fw: ['ccm'], ref: { ccm: ['A&A-01', 'STA-05'] }, f: ['S'], supp: 'ccm' },
    { id: 'SUP-03', t: 'Who-does-what agreed with the vendor', d: 'Agree which security tasks the vendor does and which stay with you.', ev: 'Shared responsibility matrix.', cad: 'Annual', fw: ['ccm'], ref: { ccm: ['STA-01', 'STA-04'] }, f: ['S', 'I'], supp: 'ccm' },
    { id: 'SUP-04', t: 'Security terms in the contract', d: 'The contract covers breach notice, audit rights and data handling.', ev: 'Signed contract or DPA clause references.', cad: 'Before contract', fw: ['iso', 'ccm'], ref: { iso: ['A.5.20'], ccm: ['STA-09'] }, f: ['S', 'I'] },
    { id: 'SUP-05', t: 'Exit plan and data export', d: 'You can get your data out in a usable format and switch provider.', ev: 'Tested export and written exit steps.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.23'], ccm: ['IPY-04'] }, f: ['S', 'I'] },
    { id: 'SUP-06', t: 'Secure tenant settings', d: 'The service’s admin settings follow a hardened baseline.', ev: 'Settings export compared with the baseline.', cad: 'Quarterly', fw: ['ccm'], ref: { ccm: ['CCC-06', 'IVS-04'] }, f: ['S'], supp: 'ccm' },
    { id: 'SUP-07', t: 'Connected apps approved', d: 'Only approved third-party apps and plug-ins can connect to the service.', ev: 'List of connected apps with approvals.', cad: 'Quarterly', fw: ['ccm'], ref: { ccm: ['STA-07'] }, f: ['S'], supp: 'ccm', c: 2 },
    { id: 'SUP-08', t: 'Cloud use follows company rules', d: 'The service is used within the company cloud policy.', ev: 'Cloud policy acknowledgement.', cad: 'Annual', fw: ['iso'], ref: { iso: ['A.5.23'] }, f: ['S', 'I'], inh: { org: 'full' } },
    { id: 'SUP-09', t: 'Vendor service changes watched', d: 'Someone reads release notes and deprecation notices and acts on them.', ev: 'Named watcher and a recent example.', cad: 'Quarterly', fw: ['ccm'], ref: { ccm: ['CCC-07'] }, f: ['S'], supp: 'ccm' },

    // Operations & change
    { id: 'OPS-01', t: 'Changes approved and recorded', d: 'Changes go through the change process with test and rollback.', ev: 'Change records for the period.', cad: 'Per change', fw: ['iso', 'ccm'], ref: { iso: ['A.8.32'], ccm: ['CCC-01'] }, f: ['I', 'O'] },
    { id: 'OPS-02', t: 'Hardened server configuration', d: 'Servers and platform services follow the company baseline.', ev: 'Policy compliance report.', cad: 'Quarterly', fw: ['iso', 'ccm'], ref: { iso: ['A.8.9'], ccm: ['IVS-04'] }, f: ['I', 'O'], inh: { p: 'lz', t: 'shared', r: 'Keep workload resources inside the landing zone policies.' } },
    { id: 'OPS-03', t: 'Patching', d: 'Operating systems and middleware are patched within the agreed time.', ev: 'Patch compliance report.', cad: 'Monthly', fw: ['iso', 'ccm'], ref: { iso: ['A.8.8'], ccm: ['TVM-03'] }, f: ['I', 'O'], inh: { p: 'lz', t: 'shared', r: 'Patch the application runtime yourself; the landing zone patches the OS.' } },
    { id: 'OPS-04', t: 'Vulnerability scanning', d: 'Scan the system and fix findings by severity.', ev: 'Latest scan and open findings.', cad: 'Monthly', fw: ['iso', 'ccm'], ref: { iso: ['A.8.8'], ccm: ['TVM-07'] }, f: ['I', 'O'] },
    { id: 'OPS-05', t: 'Malware protection', d: 'Endpoint protection runs on every server.', ev: 'Defender coverage report.', cad: 'Quarterly', fw: ['iso', 'ccm'], ref: { iso: ['A.8.7'], ccm: ['TVM-02'] }, f: ['I', 'O'], inh: { p: 'lz', t: 'full' } },
    { id: 'OPS-06', t: 'Capacity watched', d: 'Alert before the system runs out of capacity.', ev: 'Capacity alert rules.', cad: 'Quarterly', fw: ['iso'], ref: { iso: ['A.8.6'] }, f: ['I', 'O'], a: 3 },
    { id: 'OPS-07', t: 'Secure development', d: 'Custom code is reviewed and scanned before release.', ev: 'Pipeline with code scanning.', cad: 'Per change', fw: ['iso', 'ccm'], ref: { iso: ['A.8.25', 'A.8.28'], ccm: ['AIS-04'] }, f: ['I'] },
    { id: 'OPS-08', t: 'Penetration test', d: 'An independent tester attacks the system before go-live and after major change.', ev: 'Test report and fix status.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.29'], ccm: ['AIS-05'] }, c: 3 },
    { id: 'OPS-09', t: 'Network segmentation', d: 'The system sits in its own network zone with only needed traffic allowed.', ev: 'Network diagram and firewall rules.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.22'], ccm: ['IVS-06'] }, f: ['I', 'O'], inh: { p: 'lz', t: 'shared', r: 'Request only the flows the system needs.' } },
    { id: 'OPS-10', t: 'Web application firewall and DDoS protection', d: 'Public endpoints sit behind a WAF with DDoS protection.', ev: 'WAF policy reference.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.20'], ccm: ['IVS-09'] }, f: ['I'], a: 3, inh: { p: 'lz', t: 'full' } },
    { id: 'OPS-11', t: 'Infrastructure defined as code', d: 'Cloud resources are deployed from reviewed templates.', ev: 'Repository link.', cad: 'Per change', fw: ['ccm'], ref: { ccm: ['IVS-03', 'CCC-04'] }, f: ['I'], supp: 'ccm' },

    // Logging & monitoring
    { id: 'LOG-01', t: 'Security logs collected', d: 'Sign-in and admin logs are sent to central security monitoring.', ev: 'Log source shown as connected.', cad: 'Quarterly', fw: ['iso', 'ccm'], ref: { iso: ['A.8.15'], ccm: ['LOG-08'] }, inh: { p: 'soc', t: 'shared', r: 'Connect the system’s audit log to the SOC.' } },
    { id: 'LOG-02', t: 'Logs kept for 12 months', d: 'Security logs are protected and kept for at least 12 months.', ev: 'Retention setting.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.15'], ccm: ['LOG-02', 'LOG-04'] }, c: 2, inh: { p: 'soc', t: 'full' } },
    { id: 'LOG-03', t: 'Alerts handled around the clock', d: 'Security alerts from the system are triaged 24/7.', ev: 'Alert rules and on-call schedule.', cad: 'Quarterly', fw: ['iso', 'ccm'], ref: { iso: ['A.8.16'], ccm: ['LOG-03'] }, c: 3, inh: { p: 'soc', t: 'full' } },
    { id: 'LOG-04', t: 'Clocks synchronised', d: 'Servers use the company time source.', ev: 'NTP configuration.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.17'], ccm: ['LOG-06'] }, f: ['I', 'O'], inh: { p: 'lz', t: 'full' } },
    { id: 'LOG-05', t: 'Service audit log exported', d: 'The vendor’s audit log is pulled out through its API so it survives the subscription.', ev: 'Export job or connector.', cad: 'Quarterly', fw: ['ccm'], ref: { ccm: ['LOG-05', 'LOG-07'] }, f: ['S'], supp: 'ccm', inh: { p: 'soc', t: 'shared', r: 'Grant the SOC connector read access to the audit API.' } },

    // Backup & continuity
    { id: 'RES-01', t: 'Backups taken', d: 'Data is backed up on a schedule that matches the downtime tolerance.', ev: 'Backup policy or vendor backup statement.', cad: 'Quarterly', fw: ['iso', 'ccm'], ref: { iso: ['A.8.13'], ccm: ['BCR-08'] }, inh: { p: 'bkp', t: 'shared', r: 'Add the system’s data stores to a backup policy.' } },
    { id: 'RES-02', t: 'Restore tested', d: 'Restore from backup and time it.', ev: 'Restore test record with duration.', cad: 'Semi-annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.13'], ccm: ['BCR-08'] }, a: 2 },
    { id: 'RES-03', t: 'Continuity plan', d: 'Write down how the business keeps working while the system is down.', ev: 'Continuity plan and last exercise.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.30'], ccm: ['BCR-03', 'BCR-04'] }, a: 3 },
    { id: 'RES-04', t: 'Vendor uptime matches your needs', d: 'The vendor’s SLA and recovery times are at least what the business needs.', ev: 'SLA excerpt compared with your downtime tolerance.', cad: 'Annual', fw: ['ccm'], ref: { ccm: ['BCR-01', 'STA-09'] }, f: ['S', 'I'], a: 2, supp: 'ccm' },
    { id: 'RES-05', t: 'Runs in more than one zone', d: 'The system survives the loss of one data centre zone.', ev: 'Architecture showing zone redundancy.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.8.14'], ccm: ['BCR-11'] }, f: ['I'], a: 3, inh: { p: 'lz', t: 'shared', r: 'Deploy to at least two availability zones.' } },
    { id: 'RES-06', t: 'Ransomware-safe backup copy', d: 'One backup copy cannot be changed or deleted, even by admins.', ev: 'Immutable vault setting.', cad: 'Annual', fw: ['iso'], ref: { iso: ['A.8.13'] }, i: 3, inh: { p: 'bkp', t: 'full' } },

    // Hardware & premises
    { id: 'PHY-01', t: 'Server room access controlled', d: 'Only authorised staff enter rooms hosting the system.', ev: 'Nothing from you: facilities maintains it.', cad: 'Annual', fw: ['iso'], ref: { iso: ['A.7.2', 'A.7.3'] }, f: ['O'], inh: { org: 'full' } },
    { id: 'PHY-02', t: 'Power and cooling protected', d: 'Hosting rooms have UPS, generator and climate control.', ev: 'Nothing from you: facilities maintains it.', cad: 'Annual', fw: ['iso'], ref: { iso: ['A.7.11'] }, f: ['O'], a: 2, inh: { org: 'full' } },
    { id: 'PHY-03', t: 'Hardware maintained', d: 'Servers and storage are under support and serviced.', ev: 'Support contract and service log.', cad: 'Annual', fw: ['iso'], ref: { iso: ['A.7.13'] }, f: ['O'] },
    { id: 'PHY-04', t: 'Disks wiped before disposal', d: 'Storage is wiped or destroyed with a certificate before it leaves.', ev: 'Destruction certificates.', cad: 'At disposal', fw: ['iso'], ref: { iso: ['A.7.14'] }, f: ['O'] },
    { id: 'PHY-05', t: 'Cloud data centre certified', d: 'The cloud provider’s data centres hold current certifications.', ev: 'Nothing from you: the platform team keeps the evidence.', cad: 'Annual', fw: ['ccm'], ref: { ccm: ['DCS-07', 'DCS-15'] }, f: ['I'], supp: 'ccm', inh: { p: 'lz', t: 'full' } },

    // Personal data
    { id: 'PRV-01', t: 'Listed in the record of processing', d: 'Describe what personal data the system handles and why.', ev: 'Record of processing entry.', cad: 'Annual', fw: ['gdpr'], ref: { gdpr: ['Art. 30'] } },
    { id: 'PRV-02', t: 'Legal basis documented', d: 'State the legal basis for each purpose.', ev: 'Legal basis per purpose.', cad: 'Annual', fw: ['gdpr'], ref: { gdpr: ['Art. 6'] } },
    { id: 'PRV-03', t: 'Privacy impact assessment', d: 'Assess privacy risk before go-live when the data is sensitive.', ev: 'Completed DPIA.', cad: 'Per change', fw: ['gdpr'], ref: { gdpr: ['Art. 35'] }, c: 3 },
    { id: 'PRV-04', t: 'Data processing agreement signed', d: 'The vendor has signed the company DPA, including sub-processors.', ev: 'Signed DPA and sub-processor list.', cad: 'Before contract', fw: ['gdpr', 'ccm'], ref: { gdpr: ['Art. 28'], ccm: ['STA-09'] }, f: ['S', 'I'] },
    { id: 'PRV-05', t: 'People’s data requests handled', d: 'You can find, export and delete one person’s data on request.', ev: 'Tested request procedure.', cad: 'Annual', fw: ['gdpr'], ref: { gdpr: ['Art. 15', 'Art. 17'] } },
    { id: 'PRV-06', t: 'Retention periods enforced', d: 'Personal data is deleted when its retention period ends.', ev: 'Retention rules and a deletion log.', cad: 'Annual', fw: ['gdpr', 'ccm'], ref: { gdpr: ['Art. 5(1)(e)'], ccm: ['DSP-16'] } },
    { id: 'PRV-07', t: 'Personal data breaches reported', d: 'Suspected breaches reach the privacy team fast enough to notify within 72 hours.', ev: 'Nothing from you beyond reporting: the privacy team notifies.', cad: 'Annual', fw: ['gdpr'], ref: { gdpr: ['Art. 33'] }, inh: { org: 'shared', r: 'Report suspected breaches to the privacy team within 24 hours.' } },

    // Incidents & reporting
    { id: 'INC-01', t: 'Incident contact and runbook', d: 'Name who is called and what they do when the system has a security incident.', ev: 'Runbook and contact list.', cad: 'Annual', fw: ['iso', 'ccm'], ref: { iso: ['A.5.24', 'A.5.26'], ccm: ['SEF-03'] } },
    { id: 'INC-02', t: 'Vendor tells you about incidents', d: 'The vendor notifies you of incidents within an agreed time.', ev: 'Contract clause and vendor contact.', cad: 'Annual', fw: ['ccm'], ref: { ccm: ['SEF-07', 'SEF-08'] }, f: ['S', 'I'], supp: 'ccm' },
    { id: 'INC-03', t: 'Lessons learned after incidents', d: 'Review each incident and track the follow-up actions.', ev: 'Post-incident reviews.', cad: 'Per incident', fw: ['iso', 'ccm'], ref: { iso: ['A.5.27'], ccm: ['SEF-06'] }, i: 2 },
    { id: 'INC-04', t: 'Significant incidents reported to CERT-SE', d: 'Early warning within 24 hours and a full report within 72 hours.', ev: 'Nothing from you beyond reporting: the security office files.', cad: 'Per incident', fw: ['csl'], ref: { csl: ['3 kap. 1 §'] }, supp: 'csl', inh: { org: 'shared', r: 'Escalate to the security office within 4 hours of detection.' } },
    { id: 'INC-05', t: 'Supply chain risk for the essential service', d: 'Assess the security of suppliers that the essential service depends on.', ev: 'Supplier risk assessment.', cad: 'Annual', fw: ['csl'], ref: { csl: ['2 kap. 3 § 4'] }, supp: 'csl' },
    { id: 'INC-06', t: 'Continuity for the essential service', d: 'Show how the service to society continues during a major disruption.', ev: 'Continuity plan section for the essential service.', cad: 'Annual', fw: ['csl'], ref: { csl: ['2 kap. 3 § 3'] }, a: 2, supp: 'csl' }
  ];

  const FACET_LABEL = { S: 'SaaS', I: 'Cloud platform', O: 'Own data centre' };
  const AXIS_LABEL = { c: 'Confidentiality', i: 'Integrity', a: 'Availability' };
  const AXIS_REASON = {
    c: ['', 'Internal data', 'Internal data', 'Confidential data', 'Strictly confidential data'],
    i: ['', 'Errors are minor', 'Errors cause rework', 'Errors harm customers', 'Errors are dangerous'],
    a: ['', 'Down for days is fine', 'Down a day max', 'Down hours max', 'Must always be up']
  };

  // profile: { facets:Set|[], c,i,a: 0-4, personal: bool, essential: bool, providers: Set|[] }
  function scope(p) {
    const f = new Set(p.facets);
    const s = new Set(['iso']);
    if (f.has('S') || f.has('I')) s.add('ccm'); // cloud delivery silently brings CSA CCM into scope
    if (p.personal) s.add('gdpr');
    if (p.essential) s.add('csl');
    return s;
  }

  function evaluate(p) {
    const f = new Set(p.facets);
    const prov = new Set(p.providers);
    const sc = scope(p);
    const out = new Map();
    for (const c of C) {
      if (!c.fw.some(x => sc.has(x))) continue;
      if (c.f && !c.f.some(x => f.has(x))) continue;
      let ok = true;
      for (const ax of ['c', 'i', 'a']) if (c[ax] && (p[ax] || 0) < c[ax]) ok = false;
      if (!ok) continue;

      const why = [];
      if (c.f) c.f.filter(x => f.has(x)).forEach(x => why.push(FACET_LABEL[x]));
      for (const ax of ['c', 'i', 'a']) if (c[ax]) why.push(AXIS_REASON[ax][p[ax]]);
      if (!c.fw.includes('iso')) {
        if (c.fw.includes('gdpr') && sc.has('gdpr') && !c.f) why.push('Personal data');
        if (c.fw.includes('csl')) why.push('Essential service');
      } else if (c.fw.includes('gdpr') && sc.has('gdpr') && why.length === 0) why.push('Personal data');
      if (c.fw.length === 1 && c.fw[0] === 'gdpr' && !why.includes('Personal data')) why.unshift('Personal data');

      let resp = 'you', via = null, r = null;
      if (c.inh && c.inh.org) { resp = c.inh.org === 'full' ? 'covered' : 'shared'; via = 'Company-wide'; r = c.inh.r || null; }
      else if (c.inh && c.inh.p && prov.has(c.inh.p)) { resp = c.inh.t === 'full' ? 'covered' : 'shared'; via = PROVIDERS[c.inh.p].name; r = c.inh.r || null; }

      out.set(c.id, { c, why: why.length ? [...new Set(why)] : ['Every system'], resp, via, r, scope: sc });
    }
    return out;
  }

  // Requirement trace: which in-scope frameworks' requirements this control satisfies
  function trace(c, sc) {
    return Object.keys(c.ref).filter(k => sc.has(k)).map(k => ({ fw: FRAMEWORKS[k], key: k, refs: c.ref[k] }));
  }

  window.Onb = { LEVELS, FRAMEWORKS, DOMAINS, PROVIDERS, CONTROLS: C, FACET_LABEL, AXIS_LABEL, scope, evaluate, trace };
})();

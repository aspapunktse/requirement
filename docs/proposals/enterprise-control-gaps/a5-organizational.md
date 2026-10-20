# Enterprise Control proposals: A.5 Organizational controls

Follow-up to #219. The Enterprise Control Library proposal (`/design/enterprise-library/proposal-a.html`, from [Document F, Hybrid Control Matrix](https://www.aspa.se/grc/f-hybrid-control-matrix.html)) leaves 62 ISO/IEC 27001:2022 Annex A items without an Enterprise Control. This document proposes how to cover the **23 uncovered A.5 items**: with a new Enterprise Control, or by extending one of Document F's 26. One Enterprise Control may absorb several Annex A items, and every mapping decision has a rationale.

This is a proposal for review by the product owner, not a change to the app, the database or the design prototype. Like Document F, every parameter, owner role, environment note and mapping marked "to verify" is illustrative. The conventions and the questions that apply to all four themes are in [README.md](README.md).

## Summary

- 23 uncovered items in A.5.
- 13 new Enterprise Controls proposed here: CTL-PM-002, CTL-PM-003, CTL-AC-005, CTL-SI-002, CTL-SA-001, CTL-RA-001, CTL-SC-005, CTL-SR-002, CTL-IR-003, CTL-CP-003, CTL-PM-004, CTL-SI-003, CTL-CA-001.
- 1 Document F control extended here: CTL-AC-004.

## Mapping decisions

| Annex A item | Mapped to | Decision | Why |
| --- | --- | --- | --- |
| A.5.1 Policies for information security | [CTL-PM-002](#ctl-pm-002) | New Enterprise Control | The core of the control: an approved, communicated and periodically reviewed policy set. |
| A.5.2 Information security roles and responsibilities | [CTL-PM-003](#ctl-pm-003) | New Enterprise Control | Defined and allocated roles are directly testable: every role and every control owner field has a named, current holder. |
| A.5.3 Segregation of duties | [CTL-AC-005](#ctl-ac-005) | New Enterprise Control | Segregation of duties is a property of the same role model: the conflict matrix is checked against the same role assignments, in the same identity systems, by the same team. |
| A.5.4 Management responsibilities | [CTL-PM-003](#ctl-pm-003) | New Enterprise Control | Management responsibility is evidenced by the same review: line managers confirm that their people follow the policies. It has no separate artefact worth its own control. |
| A.5.6 Contact with special interest groups | [CTL-SI-002](#ctl-si-002) | New Enterprise Control | Contact with special interest groups is valued mainly as a source of threat information and warnings; membership is evidenced in the source list and the test checks that each listed group is active. |
| A.5.7 Threat intelligence | [CTL-SI-002](#ctl-si-002) | New Enterprise Control | Collecting and analysing threat information is the control itself. |
| A.5.8 Information security in project management | [CTL-SA-001](#ctl-sa-001) | New Enterprise Control | Security in project management is evidenced by the gate records. |
| A.5.10 Acceptable use of information and other assets | [CTL-PM-002](#ctl-pm-002) | New Enterprise Control | Acceptable use rules are a topic-specific policy with the same approve, publish and review lifecycle and the same evidence (document register, read receipts). Personnel acknowledging them is tested under CTL-PS-001 (terms of employment or engagement). |
| A.5.11 Return of assets | [CTL-AC-004](#ctl-ac-004) | Extend Document F control | Return of assets happens at the same trigger (HR termination date) and is checked against the same HR record. NIST PS-4, which CTL-AC-004 already maps, explicitly includes retrieving organizational property. |
| A.5.12 Classification of information | [CTL-RA-001](#ctl-ra-001) | New Enterprise Control | Classification is the first half of the statement; the System's confidentiality, integrity and availability classification in this app is part of the evidence. |
| A.5.13 Labelling of information | [CTL-RA-001](#ctl-ra-001) | New Enterprise Control | Labelling is how a classification becomes visible and machine-enforceable (it drives CTL-SC-005, data leakage prevention). Separating them would leave a label control without a scheme to test against. |
| A.5.14 Information transfer | [CTL-SC-005](#ctl-sc-005) | New Enterprise Control | Rules and agreements for transfer define the allowed channels; Document F's CTL-SC-001 covers only encryption in transit, not which channels and recipients are allowed. |
| A.5.15 Access control | [CTL-AC-005](#ctl-ac-005) | New Enterprise Control | A.5.15 asks for access rules based on business and security requirements. Document F tests the lifecycle around access (privileged access, reviews, joiners and leavers) but not the rule set itself; the role model is that rule set. |
| A.5.23 Information security for use of cloud services | [CTL-SR-002](#ctl-sr-002) | New Enterprise Control | A.5.23 covers acquiring, using, managing and exiting cloud services. Assurance of the provider itself is already CTL-SR-001; what is left is the responsibility split and the exit, which this control tests. |
| A.5.27 Learning from information security incidents | [CTL-IR-003](#ctl-ir-003) | New Enterprise Control | Learning from incidents is the post-incident review and its tracked actions. |
| A.5.28 Collection of evidence | [CTL-IR-003](#ctl-ir-003) | New Enterprise Control | Collection of evidence happens in the same incidents and is checked in the same review (was custody recorded?). It has the same owner and the same case records. |
| A.5.29 Information security during disruption | [CTL-CP-003](#ctl-cp-003) | New Enterprise Control | Keeping security at the agreed level during a disruption is the plan part of the statement. CTL-CP-002 (A.5.30) tests restoring from backup, not operating securely while degraded. |
| A.5.31 Legal, statutory and regulatory requirements | [CTL-PM-004](#ctl-pm-004) | New Enterprise Control | The obligations register is the control; in this app, the Frameworks in scope of a System are part of it. |
| A.5.32 Intellectual property rights | [CTL-PM-004](#ctl-pm-004) | New Enterprise Control | Intellectual property rights are one kind of legal obligation, held in the same register; the licence reconciliation gives them a measurable test. CTL-CM-004 (approved software) was considered, but it tests what may run, not whether its use is licensed. |
| A.5.33 Protection of records | [CTL-SI-003](#ctl-si-003) | New Enterprise Control | Protection of records is the retention half: kept for the required time, integrity protected. |
| A.5.35 Independent review of information security | [CTL-CA-001](#ctl-ca-001) | New Enterprise Control | Independent review: in this app, an Internal Audit is the evidence. |
| A.5.36 Compliance with policies, rules and standards | [CTL-CA-001](#ctl-ca-001) | New Enterprise Control | Compliance with policies and standards is the first-line check that feeds the same nonconformity list. Same follow-up, same register, so one control. |
| A.5.37 Documented operating procedures | [CTL-PM-002](#ctl-pm-002) | New Enterprise Control | Operating procedures are the lowest tier of the same document hierarchy. One register and one review cycle test all three; a separate control would duplicate the evidence. |

## Proposed new Enterprise Controls

### CTL-PM-002

**Information security policy framework**

| Field | Value |
| --- | --- |
| Statement | The information security policy, the topic-specific policies (including acceptable use) and the operating procedures for in-scope systems are approved by {policy_approver}, published to the personnel they apply to, and reviewed at least every {policy_review_period} and after a significant change. |
| Parameters (illustrative) | policy_approver = top management for the policy, the CISO for topic-specific policies, the System owner for procedures; policy_review_period = 12 months |
| Control behaviour | PREVENTIVE |
| Domain group | Governance and assurance |
| Owner role | Chief information security officer |
| ISO 27001 Annex A | A.5.1; A.5.10; A.5.37 |
| NIST SP 800-53 Rev. 5 | PM-1; PL-4; the -1 policy and procedure control of each family (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (a) |
| Environments (illustrative) | Organization-wide: one record, no per-environment cells. Procedures are per System but held in the same register. |

Why each Annex A item maps here:

- **A.5.1 Policies for information security.** The core of the control: an approved, communicated and periodically reviewed policy set.
- **A.5.10 Acceptable use of information and other assets.** Acceptable use rules are a topic-specific policy with the same approve, publish and review lifecycle and the same evidence (document register, read receipts). Personnel acknowledging them is tested under CTL-PS-001 (terms of employment or engagement).
- **A.5.37 Documented operating procedures.** Operating procedures are the lowest tier of the same document hierarchy. One register and one review cycle test all three; a separate control would duplicate the evidence.

**Rationale.** Document F leaves policies out because they are not implemented per environment. They still have a single testable property, "approved, published and current", with one owner and one evidence source, which is what an Enterprise Control needs. Grouping the three document tiers keeps the library from carrying three controls that share a register, a reviewer and a test.

### CTL-PM-003

**Security roles and management accountability**

| Field | Value |
| --- | --- |
| Statement | Every information security role in the role catalog, including the owner of every Enterprise Control and every in-scope System, is assigned to a named person, and management confirms at least every {role_review_period} that personnel apply the policies in their area. |
| Parameters (illustrative) | role_review_period = 12 months |
| Control behaviour | PREVENTIVE |
| Domain group | Governance and assurance |
| Owner role | Chief information security officer |
| ISO 27001 Annex A | A.5.2; A.5.4 |
| NIST SP 800-53 Rev. 5 | PM-2; PM-29 (to verify); PS-9 |
| NIS2 Art. 21(2) point (other articles named) | (a); Art. 20 (management accountability) applies as well |
| Environments (illustrative) | Organization-wide. |

Why each Annex A item maps here:

- **A.5.2 Information security roles and responsibilities.** Defined and allocated roles are directly testable: every role and every control owner field has a named, current holder.
- **A.5.4 Management responsibilities.** Management responsibility is evidenced by the same review: line managers confirm that their people follow the policies. It has no separate artefact worth its own control.

**Rationale.** Roles and management commitment are two sides of the same governance record. In this app the owner fields of Systems and Controls already hold part of the evidence, so the test can be partly automated (no empty or departed owner).

### CTL-AC-005

**Role-based access and segregation of duties**

| Field | Value |
| --- | --- |
| Statement | Access to in-scope systems is granted only through roles in an approved role model based on least privilege and need-to-know, and the conflicting role combinations listed in {sod_matrix} are blocked at assignment or detected within {sod_detection_period}. |
| Parameters (illustrative) | sod_matrix = the approved segregation-of-duties matrix; sod_detection_period = 7 days |
| Control behaviour | PREVENTIVE |
| Domain group | Identity and access |
| Owner role | Head of identity and access management |
| ISO 27001 Annex A | A.5.3; A.5.15 |
| NIST SP 800-53 Rev. 5 | AC-3; AC-5; AC-6 |
| NIS2 Art. 21(2) point (other articles named) | (i) |
| Environments (illustrative) | All six columns. SaaS and the Azure columns via Entra roles and vendor RBAC; AWS via IAM Identity Center permission sets; on-premises via Active Directory groups; Legacy via native roles, often COMPENSATING (periodic conflict report). |

Why each Annex A item maps here:

- **A.5.3 Segregation of duties.** Segregation of duties is a property of the same role model: the conflict matrix is checked against the same role assignments, in the same identity systems, by the same team.
- **A.5.15 Access control.** A.5.15 asks for access rules based on business and security requirements. Document F tests the lifecycle around access (privileged access, reviews, joiners and leavers) but not the rule set itself; the role model is that rule set.

**Rationale.** A.5.15 is the umbrella that CTL-AC-001 to CTL-AC-004 implement in part, so mapping it to any one of them would overstate that control. A new control for the role model and its conflict rules closes the gap with a concrete test: assignments are evaluated against the matrix.

### CTL-SI-002

**Threat intelligence**

| Field | Value |
| --- | --- |
| Statement | Threat intelligence from the approved sources, including the special interest groups and authorities listed in {ti_sources}, is assessed at least every {ti_review_interval}, and each relevant item is turned into a detection, vulnerability or risk action within {ti_action_sla}. |
| Parameters (illustrative) | ti_sources = national CSIRT, sector ISAC, vendor advisories, commercial feed; ti_review_interval = 1 week; ti_action_sla = 10 working days |
| Control behaviour | PROACTIVE |
| Domain group | Logging and detection |
| Owner role | Head of security operations |
| ISO 27001 Annex A | A.5.6; A.5.7 |
| NIST SP 800-53 Rev. 5 | PM-16; SI-5; PM-15 |
| NIS2 Art. 21(2) point (other articles named) | to verify ((e) and (g) are the nearest points) |
| Environments (illustrative) | Organization-wide process; the resulting actions land in the per-environment cells of CTL-AU-002 and CTL-VR-001. |

Why each Annex A item maps here:

- **A.5.6 Contact with special interest groups.** Contact with special interest groups is valued mainly as a source of threat information and warnings; membership is evidenced in the source list and the test checks that each listed group is active.
- **A.5.7 Threat intelligence.** Collecting and analysing threat information is the control itself.

**Rationale.** Both items feed the same intake and the same owner. Measuring "intelligence turned into action" makes the control testable instead of a list of memberships.

### CTL-SA-001

**Security requirements in projects and acquisitions**

| Field | Value |
| --- | --- |
| Statement | Every project that introduces or significantly changes an in-scope system records its security requirements and a risk assessment before design approval, and passes a security gate before go-live in which every requirement is met or has an approved exception. |
| Parameters (illustrative) | none |
| Control behaviour | PREVENTIVE |
| Domain group | Secure development |
| Owner role | Head of enterprise architecture |
| ISO 27001 Annex A | A.5.8; A.8.26 |
| NIST SP 800-53 Rev. 5 | SA-3; SA-4; RA-3 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (e) |
| Environments (illustrative) | Per System rather than per environment: the gate runs once per project. It matches what this app already does at System onboarding. |

Why each Annex A item maps here:

- **A.5.8 Information security in project management.** Security in project management is evidenced by the gate records.
- **A.8.26 Application security requirements.** Application security requirements are the content of the same gate: they are identified when a system is developed or acquired. One gate, one record and one owner cover both, so they share a control. Listed by reference in the A.8 issue.

**Rationale.** The app's onboarding of a System against its applicable Controls is the natural evidence for this control, which makes it one of the easiest to test continuously. Grouping A.5.8 with A.8.26 avoids testing the same gate twice.

### CTL-RA-001

**Information classification and labelling**

| Field | Value |
| --- | --- |
| Statement | Every in-scope system and information repository has a classification under the approved scheme {classification_scheme}, and information in it is labelled by {labelling_mechanism}, with unlabelled content below {unlabelled_tolerance}. |
| Parameters (illustrative) | classification_scheme = the four-level scheme; labelling_mechanism = sensitivity labels (default label applied automatically in Microsoft 365); unlabelled_tolerance = 5% of new documents |
| Control behaviour | PREVENTIVE |
| Domain group | Asset and configuration |
| Owner role | Head of information management (role to define) |
| ISO 27001 Annex A | A.5.12; A.5.13 |
| NIST SP 800-53 Rev. 5 | RA-2; MP-3; AC-16 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (i) (to verify) |
| Environments (illustrative) | SaaS (sensitivity labels), Azure platform and workload and AWS (classification tags on resources, enforced by policy), on-premises (file server classification, often COMPENSATING), Legacy (classification recorded at System level only). |

Why each Annex A item maps here:

- **A.5.12 Classification of information.** Classification is the first half of the statement; the System's confidentiality, integrity and availability classification in this app is part of the evidence.
- **A.5.13 Labelling of information.** Labelling is how a classification becomes visible and machine-enforceable (it drives CTL-SC-005, data leakage prevention). Separating them would leave a label control without a scheme to test against.

**Rationale.** The two items are always implemented together. A ratio of unlabelled content gives an automatable PASS/FAIL criterion, which Document F asks of every control.

### CTL-SC-005

**Information transfer and data leakage prevention**

| Field | Value |
| --- | --- |
| Statement | Information leaves the organization only through approved transfer channels under the transfer rules {transfer_rules}, and data leakage prevention policies block or alert on transfers of information labelled {dlp_scope} outside them, with alerts triaged within {dlp_triage_sla}. |
| Parameters (illustrative) | transfer_rules = the topic-specific policy on information transfer, including transfer agreements with external parties; dlp_scope = Confidential and above; dlp_triage_sla = 1 working day |
| Control behaviour | PREVENTIVE |
| Domain group | Protection |
| Owner role | Head of security operations |
| ISO 27001 Annex A | A.5.14; A.8.12 |
| NIST SP 800-53 Rev. 5 | AC-4; CA-3; SC-7(10) (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (j) (to verify) |
| Environments (illustrative) | SaaS (Microsoft Purview DLP), on-premises (mail and web gateway), Azure platform and AWS (egress control on storage and network), Azure workload (inherited), Legacy (COMPENSATING: egress filtering only). |

Why each Annex A item maps here:

- **A.5.14 Information transfer.** Rules and agreements for transfer define the allowed channels; Document F's CTL-SC-001 covers only encryption in transit, not which channels and recipients are allowed.
- **A.8.12 Data leakage prevention.** Data leakage prevention is the technical enforcement of the same rules, applied to the same labels. Listed by reference in the A.8 issue.

**Rationale.** A.5.14 without enforcement is a policy; A.8.12 without the rules has nothing to enforce. One control with one test (attempted transfers against rules) covers both and depends on CTL-RA-001 for its labels.

### CTL-SR-002

**Cloud service responsibility and exit**

| Field | Value |
| --- | --- |
| Statement | Every in-scope cloud service has a recorded split of security responsibilities between provider and customer for each applicable control, and an exit plan that is reviewed at least every {exit_review_period}. |
| Parameters (illustrative) | exit_review_period = 24 months, and at contract renewal |
| Control behaviour | PROACTIVE |
| Domain group | Supplier and provider assurance |
| Owner role | Head of procurement and vendor risk, with the head of platform engineering |
| ISO 27001 Annex A | A.5.23 |
| NIST SP 800-53 Rev. 5 | SA-9 (responsibility split); no direct control for exit planning |
| NIS2 Art. 21(2) point (other articles named) | (d) |
| Environments (illustrative) | SaaS, Azure platform, Azure workload and AWS. n/a on-premises and Legacy. |

Why each Annex A item maps here:

- **A.5.23 Information security for use of cloud services.** A.5.23 covers acquiring, using, managing and exiting cloud services. Assurance of the provider itself is already CTL-SR-001; what is left is the responsibility split and the exit, which this control tests.

**Rationale.** Mapping A.5.23 into CTL-SR-001 was considered and rejected: SR-001 tests a provider's evidence, not the customer's side of the shared responsibility or the exit. The responsibility split is what this app models as Control Offerings (Full or Shared) on a Provider (ADR 0008), so the evidence already has a home.

### CTL-IR-003

**Post-incident review and evidence handling**

| Field | Value |
| --- | --- |
| Statement | Every incident of severity {pir_severity} or higher has a post-incident review within {pir_deadline} whose actions are tracked to closure, and evidence for incidents that may lead to legal or disciplinary action is collected and kept under a recorded chain of custody. |
| Parameters (illustrative) | pir_severity = high; pir_deadline = 10 working days |
| Control behaviour | CORRECTIVE |
| Domain group | Incident management |
| Owner role | Head of security operations |
| ISO 27001 Annex A | A.5.27; A.5.28 |
| NIST SP 800-53 Rev. 5 | IR-4 (lessons learned); IR-8; AU-9 (to verify: chain of custody has no direct control) |
| NIS2 Art. 21(2) point (other articles named) | (b) |
| Environments (illustrative) | Organization-wide process. Evidence sources differ per environment (Sentinel, CloudTrail, EDR, on-premises SIEM), which Document F's logging controls already cover. |

Why each Annex A item maps here:

- **A.5.27 Learning from information security incidents.** Learning from incidents is the post-incident review and its tracked actions.
- **A.5.28 Collection of evidence.** Collection of evidence happens in the same incidents and is checked in the same review (was custody recorded?). It has the same owner and the same case records.

**Rationale.** Extending CTL-IR-001 was considered: it already maps A.5.24 to A.5.26. Its test, however, is "handled and closed under the process and exercised", while these two items happen after closure and need their own PASS/FAIL (a review exists, custody recorded). A separate control keeps each test single-purpose.

### CTL-CP-003

**Continuity and redundancy of critical systems**

| Field | Value |
| --- | --- |
| Statement | Every in-scope system with availability class {availability_class} or higher has a continuity plan that keeps its security controls in force during a disruption, runs with redundancy that meets its availability requirement, and has its failover exercised at least every {failover_test_interval}. |
| Parameters (illustrative) | availability_class = high; failover_test_interval = 12 months |
| Control behaviour | PROACTIVE |
| Domain group | Resilience |
| Owner role | Head of IT operations |
| ISO 27001 Annex A | A.5.29; A.8.14 |
| NIST SP 800-53 Rev. 5 | CP-2; CP-7; SC-36 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (c) |
| Environments (illustrative) | All six. SaaS and Azure platform: mostly P (provider), inherited via CTL-SR-001; Azure workload and AWS: zone or region redundancy; on-premises: second site; Legacy: often COMPENSATING (manual fallback). |

Why each Annex A item maps here:

- **A.5.29 Information security during disruption.** Keeping security at the agreed level during a disruption is the plan part of the statement. CTL-CP-002 (A.5.30) tests restoring from backup, not operating securely while degraded.
- **A.8.14 Redundancy of information processing facilities.** Redundancy of facilities is how the plan is met for the same systems, and a failover exercise tests both at once. Listed by reference in the A.8 issue.

**Rationale.** Both items are scoped by the System's availability classification and evidenced by the same exercise. Splitting them would require two tests of one failover.

### CTL-PM-004

**Legal, regulatory and contractual obligations**

| Field | Value |
| --- | --- |
| Statement | The legal, statutory, regulatory and contractual requirements that apply to in-scope systems, including intellectual property and software licence terms, are recorded in the obligations register, reviewed at least every {obligations_review_period}, and licence use is reconciled with entitlements at least every {licence_reconciliation_period}. |
| Parameters (illustrative) | obligations_review_period = 12 months; licence_reconciliation_period = 12 months |
| Control behaviour | DETECTIVE |
| Domain group | Governance and assurance |
| Owner role | Head of legal and compliance |
| ISO 27001 Annex A | A.5.31; A.5.32 |
| NIST SP 800-53 Rev. 5 | CM-10 (for A.5.32); no direct control for the obligations register |
| NIS2 Art. 21(2) point (other articles named) | to verify |
| Environments (illustrative) | Organization-wide; licence reconciliation draws on the SaaS admin portals and the software inventory of CTL-CM-002. |

Why each Annex A item maps here:

- **A.5.31 Legal, statutory and regulatory requirements.** The obligations register is the control; in this app, the Frameworks in scope of a System are part of it.
- **A.5.32 Intellectual property rights.** Intellectual property rights are one kind of legal obligation, held in the same register; the licence reconciliation gives them a measurable test. CTL-CM-004 (approved software) was considered, but it tests what may run, not whether its use is licensed.

**Rationale.** Grouped because both are owned by legal and compliance and evidenced by one register. A.5.33 (records) and A.5.34 (privacy) were left out: A.5.34 is already CTL-PT-001, and records retention is technical enough to deserve its own control (CTL-SI-003).

### CTL-SI-003

**Records retention and information deletion**

| Field | Value |
| --- | --- |
| Statement | Records in in-scope systems are kept for the period set in the retention schedule {retention_schedule}, protected against loss and unauthorized change during that period, and deleted within {deletion_sla} after it ends or when deletion is requested. |
| Parameters (illustrative) | retention_schedule = the approved records retention schedule; deletion_sla = 30 days |
| Control behaviour | CORRECTIVE |
| Domain group | Data protection and AI |
| Owner role | Head of information management (role to define) |
| ISO 27001 Annex A | A.5.33; A.8.10 |
| NIST SP 800-53 Rev. 5 | SI-12 (to verify: SI-12(3)); AU-11 |
| NIS2 Art. 21(2) point (other articles named) | to verify |
| Environments (illustrative) | SaaS (retention policies), Azure and AWS (lifecycle and immutability policies on storage), on-premises (backup and archive platform), Legacy (often COMPENSATING: manual deletion runs). |

Why each Annex A item maps here:

- **A.5.33 Protection of records.** Protection of records is the retention half: kept for the required time, integrity protected.
- **A.8.10 Information deletion.** Information deletion is the other end of the same schedule. A retention policy that is never enforced at the end is the most common audit finding, so testing both ends in one control is intended. Listed by reference in the A.8 issue.

**Rationale.** One schedule drives both items. Secure disposal of media (A.7.10, A.7.14) was kept out: it is about the device, not the record, and is CTL-MP-001.

### CTL-CA-001

**Independent review and compliance checks**

| Field | Value |
| --- | --- |
| Statement | The information security management system is reviewed by a party independent of the area under review at least every {independent_review_interval}, control owners check compliance with the policies in their area at least every {compliance_check_interval}, and every nonconformity is tracked to closure. |
| Parameters (illustrative) | independent_review_interval = 12 months; compliance_check_interval = 6 months |
| Control behaviour | DETECTIVE |
| Domain group | Governance and assurance |
| Owner role | Head of internal audit |
| ISO 27001 Annex A | A.5.35; A.5.36 |
| NIST SP 800-53 Rev. 5 | CA-2 (to verify: CA-2(1)); CA-5; CA-7 |
| NIS2 Art. 21(2) point (other articles named) | (f) |
| Environments (illustrative) | Organization-wide. |

Why each Annex A item maps here:

- **A.5.35 Independent review of information security.** Independent review: in this app, an Internal Audit is the evidence.
- **A.5.36 Compliance with policies, rules and standards.** Compliance with policies and standards is the first-line check that feeds the same nonconformity list. Same follow-up, same register, so one control.

**Rationale.** The two items are the second and first line of the same assurance loop, and both end in tracked nonconformities. Protection of systems during audit testing (A.8.34) is a separate control (CTL-CA-002), because it constrains how tests are run rather than following up their results.

## Proposed extensions of Document F controls

### CTL-AC-004

**Joiner, mover and leaver deprovisioning** (Document F; today maps A.5.16; A.5.18; A.6.5)

| Field | Value |
| --- | --- |
| Statement today | Access of a leaver is disabled within {leaver_sla} of the HR termination date and access of a mover is re-approved within {mover_sla}. |
| Proposed statement | Access of a leaver is disabled within {leaver_sla} of the HR termination date, assets issued to the leaver are returned or remotely wiped within {asset_return_sla}, and access of a mover is re-approved within {mover_sla}. |
| Added parameters (illustrative) | asset_return_sla = 5 working days |
| Added Annex A | A.5.11 |
| NIST SP 800-53 Rev. 5 | unchanged (PS-4 already covers asset return) |
| NIS2 Art. 21(2) point (other articles named) | unchanged ((i)) |

Why each Annex A item maps here:

- **A.5.11 Return of assets.** Return of assets happens at the same trigger (HR termination date) and is checked against the same HR record. NIST PS-4, which CTL-AC-004 already maps, explicitly includes retrieving organizational property.

**Rationale.** A new control would duplicate the leaver trigger and evidence. The cost is a second evidence source (asset register), and the owner may need to share the control with IT operations.

## Out of scope

- Any change to the app, the database, the seed, `CONTEXT.md` or the design prototype. If the product owner accepts these proposals, adding them to `public/design/enterprise-library/enterprise-data.js` (so the crosswalk shows no uncovered items) is a separate issue.
- Per-environment cells (party, origin, Stage, tests) for the new controls. They follow once the control-level proposal is accepted.

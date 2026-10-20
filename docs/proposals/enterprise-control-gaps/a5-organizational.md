# Enterprise Control proposals: A.5 Organizational controls

Follow-up to #219. The Enterprise Control Library proposal (`/design/enterprise-library/proposal-a.html`, from [Document F, Hybrid Control Matrix](https://www.aspa.se/grc/f-hybrid-control-matrix.html)) leaves 62 ISO/IEC 27001:2022 Annex A items without an Enterprise Control. This document proposes how to cover the **23 uncovered A.5 items**: with a new Enterprise Control, or by extending one of Document F's 26. One Enterprise Control may absorb several Annex A items, and every mapping decision has a rationale.

This is a proposal for review by the product owner, not a change to the app, the database or the design prototype. Like Document F, every parameter, owner role, environment note and mapping marked "to verify" is illustrative. The conventions and the questions that apply to all four themes are in [README.md](README.md).

## Summary

- 23 uncovered items in A.5.
- 16 new Enterprise Controls proposed here: CTL-PM-002, CTL-PM-003, CTL-AC-005, CTL-SI-002, CTL-SA-001, CTL-PS-004, CTL-RA-001, CTL-SC-005, CTL-SR-002, CTL-IR-003, CTL-CP-003, CTL-PM-004, CTL-CM-006, CTL-SI-003, CTL-CA-001, CTL-CA-003.
- 0 Document F controls extended here.

## Mapping decisions

| Annex A item | Mapped to | Decision | Why |
| --- | --- | --- | --- |
| A.5.1 Policies for information security | [CTL-PM-002](#ctl-pm-002) | New Enterprise Control | The core of the control: an approved, communicated and periodically reviewed policy set. |
| A.5.2 Information security roles and responsibilities | [CTL-PM-003](#ctl-pm-003) | New Enterprise Control | Defined and allocated roles are directly testable: every role and every control owner field has a named, current and informed holder. |
| A.5.3 Segregation of duties | [CTL-AC-005](#ctl-ac-005) | New Enterprise Control | Segregation of duties is a property of the same role model: the conflict matrix is checked against the same role assignments, in the same identity systems, by the same team. |
| A.5.4 Management responsibilities | [CTL-CA-003](#ctl-ca-003) | New Enterprise Control | Management responsibilities: managers requiring their people to follow the policies is evidenced by the same recorded checks, made by the same managers. A control of its own would have no other evidence. |
| A.5.6 Contact with special interest groups | [CTL-SI-002](#ctl-si-002) | New Enterprise Control | Contact with special interest groups is valued mainly as a source of threat information and warnings; membership is evidenced in the source list and the test checks that each listed group is active. |
| A.5.7 Threat intelligence | [CTL-SI-002](#ctl-si-002) | New Enterprise Control | Collecting and analysing threat information is the control itself. |
| A.5.8 Information security in project management | [CTL-SA-001](#ctl-sa-001) | New Enterprise Control | Security in project management is evidenced by the gate records. |
| A.5.10 Acceptable use of information and other assets | [CTL-PM-002](#ctl-pm-002) | New Enterprise Control | Acceptable use rules are a topic-specific policy with the same approve, publish and review lifecycle and the same evidence (document register, read receipts). Personnel acknowledging them is tested under CTL-PS-001 (terms of employment or engagement). |
| A.5.11 Return of assets | [CTL-PS-004](#ctl-ps-004) | New Enterprise Control | Return of assets on leaving and on a role change, tested by reconciling the asset register against HR leaver and mover events. |
| A.5.12 Classification of information | [CTL-RA-001](#ctl-ra-001) | New Enterprise Control | Classification is the first half of the statement; the System's confidentiality, integrity and availability classification in this app is part of the evidence. |
| A.5.13 Labelling of information | [CTL-RA-001](#ctl-ra-001) | New Enterprise Control | Labelling is how a classification becomes visible and machine-enforceable (it drives CTL-SC-005, data leakage prevention). Separating them would leave a label control without a scheme to test against. |
| A.5.14 Information transfer | [CTL-SC-005](#ctl-sc-005) | New Enterprise Control | Rules and agreements for transfer define the allowed channels; Document F's CTL-SC-001 covers only encryption in transit, not which channels and recipients are allowed. |
| A.5.15 Access control | [CTL-AC-005](#ctl-ac-005) | New Enterprise Control | A.5.15 asks for access rules based on business and security requirements. Document F tests the lifecycle around access (privileged access, reviews, joiners and leavers) but not the rule set itself; the role model is that rule set. |
| A.5.23 Information security for use of cloud services | [CTL-SR-002](#ctl-sr-002) | New Enterprise Control | A.5.23 covers acquiring, using, configuring, managing and exiting cloud services. Assurance of the provider itself is already CTL-SR-001; this control tests the customer side: acquisition review, responsibility split, data location, configuration posture and exit. |
| A.5.27 Learning from information security incidents | [CTL-IR-003](#ctl-ir-003) | New Enterprise Control | Learning from incidents is the post-incident review and its tracked actions. |
| A.5.28 Collection of evidence | [CTL-IR-003](#ctl-ir-003) | New Enterprise Control | Collection of evidence happens in the same incidents and is checked in the same review (was custody recorded?). It has the same owner and the same case records. |
| A.5.29 Information security during disruption | [CTL-CP-003](#ctl-cp-003) | New Enterprise Control | Keeping security at the agreed level during a disruption. CTL-CP-002 (A.5.30) tests restoring from backup, not operating securely while degraded. |
| A.5.31 Legal, statutory and regulatory requirements | [CTL-PM-004](#ctl-pm-004) | New Enterprise Control | The obligations register is the control. |
| A.5.32 Intellectual property rights | [CTL-CM-006](#ctl-cm-006) | New Enterprise Control | Intellectual property rights, both directions: others' IP used within licence terms (measurable by reconciliation), and the organization's own IP protected. |
| A.5.33 Protection of records | [CTL-SI-003](#ctl-si-003) | New Enterprise Control | Protection of records is the retention half: kept for the required time, integrity protected. |
| A.5.35 Independent review of information security | [CTL-CA-001](#ctl-ca-001) | New Enterprise Control | Independent review at planned intervals and after significant change. |
| A.5.36 Compliance with policies, rules and standards | [CTL-CA-003](#ctl-ca-003) | New Enterprise Control | Compliance with policies, rules and standards: the recorded checks and the findings and exceptions register are the evidence. |
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

**Security roles and responsibilities**

| Field | Value |
| --- | --- |
| Statement | Every information security role in the role catalog, including the owner of every Enterprise Control and every in-scope System, is assigned to a named person who has been told of the role, and the catalog is reviewed at least every {role_review_period} and when people leave. |
| Parameters (illustrative) | role_review_period = 12 months |
| Control behaviour | PREVENTIVE |
| Domain group | Governance and assurance |
| Owner role | Chief information security officer |
| ISO 27001 Annex A | A.5.2 |
| NIST SP 800-53 Rev. 5 | PM-2; PM-29 (to verify); PS-9 |
| NIS2 Art. 21(2) point (other articles named) | (a); Art. 20 (management accountability) applies as well |
| Environments (illustrative) | Organization-wide. |

Why each Annex A item maps here:

- **A.5.2 Information security roles and responsibilities.** Defined and allocated roles are directly testable: every role and every control owner field has a named, current and informed holder.

**Rationale.** In this app the owner fields of Systems and Controls already hold part of the evidence, so the test can be partly automated (no empty or departed owner). Management responsibility (A.5.4) was first grouped here; after review it went to CTL-CA-003, because its evidence is the managers' compliance checks, not the role catalog.

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
| Statement | Every project with information security implications (a new or changed system, but also process, facility, supplier and organizational changes) records its security requirements and a risk assessment at start, and passes a security gate before go-live or completion in which every requirement is met or has an approved exception. |
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

### CTL-PS-004

**Return of assets**

| Field | Value |
| --- | --- |
| Statement | Assets issued to a person (devices, tokens, keys, paper files, specialist equipment) are recorded in the asset register against the holder, and when the person leaves or changes role the assets they no longer need are returned, or remotely wiped where they cannot be recovered, within {asset_return_sla}, reconciled against the asset register. |
| Parameters (illustrative) | asset_return_sla = 5 working days |
| Control behaviour | CORRECTIVE |
| Domain group | Asset and configuration |
| Owner role | Head of IT operations |
| ISO 27001 Annex A | A.5.11 |
| NIST SP 800-53 Rev. 5 | PS-4; PS-5 |
| NIS2 Art. 21(2) point (other articles named) | (i) |
| Environments (illustrative) | Organization-wide, evidenced by the asset register and HR events; device wipe through the endpoint management of each environment. |

Why each Annex A item maps here:

- **A.5.11 Return of assets.** Return of assets on leaving and on a role change, tested by reconciling the asset register against HR leaver and mover events.

**Rationale.** First proposed as an extension of CTL-AC-004 (joiner, mover and leaver deprovisioning), which shares the HR trigger. Codex review on #225 pointed out that it needs a second evidence source (the asset register) and owner, which breaks the grouping rule, and that movers were left out. A control of its own covers both.

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
| Statement | Every transfer of in-scope information, between internal systems and units as well as to external parties, uses an approved channel under the transfer rules {transfer_rules}, and data leakage prevention policies block or alert on transfers of information labelled {dlp_scope} outside them, with alerts triaged within {dlp_triage_sla}. |
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

**Cloud service security**

| Field | Value |
| --- | --- |
| Statement | Every in-scope cloud service is acquired only after a security review, has a recorded split of security responsibilities between provider and customer for each applicable control, confirmed data processing and storage locations in its agreement, is configured and continuously checked against the cloud security baseline by posture management, and has an exit plan that is reviewed at least every {exit_review_period}. |
| Parameters (illustrative) | exit_review_period = 24 months, and at contract renewal |
| Control behaviour | PROACTIVE |
| Domain group | Supplier and provider assurance |
| Owner role | Head of procurement and vendor risk, with the head of platform engineering |
| ISO 27001 Annex A | A.5.23 |
| NIST SP 800-53 Rev. 5 | SA-9 (responsibility split); SA-4 (acquisition); CM-6 (to verify: baseline); no direct control for exit planning |
| NIS2 Art. 21(2) point (other articles named) | (d) |
| Environments (illustrative) | SaaS, Azure platform, Azure workload and AWS. n/a on-premises and Legacy. |

Why each Annex A item maps here:

- **A.5.23 Information security for use of cloud services.** A.5.23 covers acquiring, using, configuring, managing and exiting cloud services. Assurance of the provider itself is already CTL-SR-001; this control tests the customer side: acquisition review, responsibility split, data location, configuration posture and exit.

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

**Security during disruption**

| Field | Value |
| --- | --- |
| Statement | Every in-scope system has disruption procedures that keep a defined minimum security baseline in force in emergency and degraded operation (emergency and break-glass access still authenticated, logged and reviewed after use; security monitoring active during failover and maintenance), and the procedures are exercised with the continuity tests at least every {disruption_exercise_interval}. |
| Parameters (illustrative) | disruption_exercise_interval = 12 months for availability class high, 24 months otherwise |
| Control behaviour | PROACTIVE |
| Domain group | Resilience |
| Owner role | Head of IT operations |
| ISO 27001 Annex A | A.5.29 |
| NIST SP 800-53 Rev. 5 | CP-2; AC-2 (to verify: break-glass accounts); SI-4 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (c) |
| Environments (illustrative) | All six. Break-glass accounts per platform (Entra, AWS root and break-glass roles, Active Directory), monitoring by CTL-AU-002. |

Why each Annex A item maps here:

- **A.5.29 Information security during disruption.** Keeping security at the agreed level during a disruption. CTL-CP-002 (A.5.30) tests restoring from backup, not operating securely while degraded.

**Rationale.** A.5.29 applies to every system that keeps running during a disruption, not only highly available ones. Redundancy (A.8.14) was first grouped here; Codex review on #225 pointed out that the availability threshold excluded lower-class systems from the security requirements, so redundancy is now CTL-CP-005 and keeps that threshold.

### CTL-PM-004

**Legal, regulatory and contractual obligations**

| Field | Value |
| --- | --- |
| Statement | The legal, statutory, regulatory and contractual requirements that apply to in-scope systems are recorded in the obligations register with the approach to meet each one, and the register is reviewed at least every {obligations_review_period} and when a law, regulation or contract changes. |
| Parameters (illustrative) | obligations_review_period = 12 months |
| Control behaviour | DETECTIVE |
| Domain group | Governance and assurance |
| Owner role | Head of legal and compliance |
| ISO 27001 Annex A | A.5.31 |
| NIST SP 800-53 Rev. 5 | no direct control for the obligations register |
| NIS2 Art. 21(2) point (other articles named) | to verify |
| Environments (illustrative) | Organization-wide. |

Why each Annex A item maps here:

- **A.5.31 Legal, statutory and regulatory requirements.** The obligations register is the control.

**Rationale.** In this app, the Frameworks in scope of a System are part of the register. Intellectual property (A.5.32) was first grouped here with a licence reconciliation; on our own re-check against the grouping rule it got its own control (CTL-CM-006), because the reconciliation has a different owner and evidence from the register.

### CTL-CM-006

**Intellectual property rights**

| Field | Value |
| --- | --- |
| Statement | Software, open-source components and third-party content used in in-scope systems are acquired from legitimate sources and used within their licence terms, with licence use reconciled with entitlements at least every {licence_reconciliation_period} and open-source licence obligations checked in the build pipeline; and the organization's own intellectual property (source code, designs, trade secrets, trademarks) is recorded, marked and protected by access restriction and confidentiality agreements. |
| Parameters (illustrative) | licence_reconciliation_period = 12 months |
| Control behaviour | DETECTIVE |
| Domain group | Asset and configuration |
| Owner role | Head of legal and compliance, with the head of IT operations |
| ISO 27001 Annex A | A.5.32 |
| NIST SP 800-53 Rev. 5 | CM-10; no direct control for protecting own intellectual property |
| NIS2 Art. 21(2) point (other articles named) | to verify |
| Environments (illustrative) | SaaS (admin portal licence counts), on-premises and the endpoint fleet (software inventory of CTL-CM-002), Azure and AWS (marketplace and bring-your-own licences), build pipelines (open-source licence scan). |

Why each Annex A item maps here:

- **A.5.32 Intellectual property rights.** Intellectual property rights, both directions: others' IP used within licence terms (measurable by reconciliation), and the organization's own IP protected.

**Rationale.** CTL-CM-004 (approved software) was considered, but it tests what may run, not whether its use is licensed. Kept apart from CTL-PM-004 because licence counts and pipeline scans are IT evidence, not a legal register.

### CTL-SI-003

**Records retention and information deletion**

| Field | Value |
| --- | --- |
| Statement | Records in in-scope systems are kept for the period set in the retention schedule {retention_schedule}, protected against loss, unauthorized change and deletion during that period, and deleted, including from backups, within {deletion_sla} after it ends or when deletion is requested; other in-scope information (exports, caches, uploads, temporary files) is deleted when no longer needed and at the latest after {temporary_data_max_age}. |
| Parameters (illustrative) | retention_schedule = the approved records retention schedule; deletion_sla = 30 days; temporary_data_max_age = 90 days |
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

**Independent review of information security**

| Field | Value |
| --- | --- |
| Statement | The information security management system and its controls are reviewed by a party independent of the area under review at least every {independent_review_interval} and after significant changes, and every nonconformity found is tracked to closure. |
| Parameters (illustrative) | independent_review_interval = 12 months |
| Control behaviour | DETECTIVE |
| Domain group | Governance and assurance |
| Owner role | Head of internal audit |
| ISO 27001 Annex A | A.5.35 |
| NIST SP 800-53 Rev. 5 | CA-2 (to verify: CA-2(1)); CA-5 |
| NIS2 Art. 21(2) point (other articles named) | (f) |
| Environments (illustrative) | Organization-wide. |

Why each Annex A item maps here:

- **A.5.35 Independent review of information security.** Independent review at planned intervals and after significant change.

**Rationale.** In this app, an Internal Audit is the evidence. The first-line compliance checks (A.5.36) were first grouped here; Codex review on #225 pointed out that an audit report cannot show that every owner did their check, and the reverse, so they are now CTL-CA-003. Protection of systems during audit testing (A.8.34) is CTL-CA-002, because it constrains how tests are run.

### CTL-CA-003

**Compliance with policies**

| Field | Value |
| --- | --- |
| Statement | Managers and control owners check that the policies, rules and standards in their area are followed at least every {compliance_check_interval}, record the result, document each deviation as a finding with an owner and due date or as an approved exception with a risk acceptance, and track it to closure. |
| Parameters (illustrative) | compliance_check_interval = 6 months; automated policy-as-code checks count as continuous checks for cloud baselines |
| Control behaviour | DETECTIVE |
| Domain group | Governance and assurance |
| Owner role | Chief information security officer |
| ISO 27001 Annex A | A.5.4; A.5.36 |
| NIST SP 800-53 Rev. 5 | CA-7; CA-5; PM-2 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (f) |
| Environments (illustrative) | Organization-wide; cloud baselines checked continuously through CTL-CM-001. |

Why each Annex A item maps here:

- **A.5.4 Management responsibilities.** Management responsibilities: managers requiring their people to follow the policies is evidenced by the same recorded checks, made by the same managers. A control of its own would have no other evidence.
- **A.5.36 Compliance with policies, rules and standards.** Compliance with policies, rules and standards: the recorded checks and the findings and exceptions register are the evidence.

**Rationale.** Split from CTL-CA-001 after Codex review on #225: first-line checks have different owners and evidence from an independent review. A.5.4 joins it because a manager's responsibility for policy compliance is shown by doing these checks.

## Out of scope

- Any change to the app, the database, the seed, `CONTEXT.md` or the design prototype. If the product owner accepts these proposals, adding them to `public/design/enterprise-library/enterprise-data.js` (so the crosswalk shows no uncovered items) is a separate issue.
- Per-environment cells (party, origin, Stage, tests) for the new controls. They follow once the control-level proposal is accepted.

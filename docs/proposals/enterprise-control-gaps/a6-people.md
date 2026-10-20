# Enterprise Control proposals: A.6 People controls

Follow-up to #219. The Enterprise Control Library proposal (`/design/enterprise-library/proposal-a.html`, from [Document F, Hybrid Control Matrix](https://www.aspa.se/grc/f-hybrid-control-matrix.html)) leaves 62 ISO/IEC 27001:2022 Annex A items without an Enterprise Control. This document proposes how to cover the **7 uncovered A.6 items**: with a new Enterprise Control, or by extending one of Document F's 26. One Enterprise Control may absorb several Annex A items, and every mapping decision has a rationale.

This is a proposal for review by the product owner, not a change to the app, the database or the design prototype. Like Document F, every parameter, owner role, environment note and mapping marked "to verify" is illustrative. The conventions and the questions that apply to all four themes are in [README.md](README.md).

## Summary

- 7 uncovered items in A.6.
- 5 new Enterprise Controls proposed here: CTL-PS-001, CTL-PS-002, CTL-PS-003, CTL-AT-001, CTL-AC-006.
- 1 Document F control extended here: CTL-IR-001.

## Mapping decisions

| Annex A item | Mapped to | Decision | Why |
| --- | --- | --- | --- |
| A.6.1 Screening | [CTL-PS-001](#ctl-ps-001) | New Enterprise Control | Screening, tested at the joiner step before an account is created. |
| A.6.2 Terms and conditions of employment | [CTL-PS-001](#ctl-ps-001) | New Enterprise Control | Terms and conditions are signed at the same step and checked against the same HR record. |
| A.6.3 IS awareness, education and training | [CTL-AT-001](#ctl-at-001) | New Enterprise Control | Awareness, education and training: measurable through completion records. |
| A.6.4 Disciplinary process | [CTL-PS-003](#ctl-ps-003) | New Enterprise Control | Disciplinary process: tested by sampling confirmed violations (from incidents under CTL-IR-001 and nonconformities under CTL-CA-001) for a recorded decision. |
| A.6.6 Confidentiality or non-disclosure agreements | [CTL-PS-002](#ctl-ps-002) | New Enterprise Control | Confidentiality or non-disclosure agreements: the periodic review of the requirements and a signed, current agreement per person or party are both tested. |
| A.6.7 Remote working | [CTL-AC-006](#ctl-ac-006) | New Enterprise Control | Remote working: access is conditioned on a compliant device. |
| A.6.8 Information security event reporting | [CTL-IR-001](#ctl-ir-001) | Extend Document F control | Event reporting by personnel is the entry point of the incident process this control already tests (A.5.24 to A.5.26). Reports and their acknowledgement live in the same case tool. |

## Proposed new Enterprise Controls

### CTL-PS-001

**Personnel screening and terms of employment**

| Field | Value |
| --- | --- |
| Statement | Before access is granted, every employee and contractor has been screened to the level {screening_level} required for their role and has signed terms of employment or engagement that state their information security responsibilities and the acceptable use rules. |
| Parameters (illustrative) | screening_level = identity, right to work and references for all; criminal record and credit check for roles marked sensitive |
| Control behaviour | PREVENTIVE |
| Domain group | People |
| Owner role | Head of human resources |
| ISO 27001 Annex A | A.6.1; A.6.2 |
| NIST SP 800-53 Rev. 5 | PS-3; PS-7 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (i) |
| Environments (illustrative) | Organization-wide, evidenced by the HR system and the joiner step that also triggers CTL-AC-004. |

Why each Annex A item maps here:

- **A.6.1 Screening.** Screening, tested at the joiner step before an account is created.
- **A.6.2 Terms and conditions of employment.** Terms and conditions are signed at the same step and checked against the same HR record.

**Rationale.** Both items are evidenced by one record per person at one moment: before the first account is created. The joiner process of CTL-AC-004 is the natural test point (no account without a completed HR record). Confidentiality agreements (A.6.6) and the disciplinary process (A.6.4) were first grouped here too; after review they got their own controls (CTL-PS-002, CTL-PS-003), because both need tests after onboarding that this joiner gate cannot give.

### CTL-PS-002

**Confidentiality and non-disclosure agreements**

| Field | Value |
| --- | --- |
| Statement | The confidentiality requirements for personnel and external parties are documented and reviewed at least every {nda_review_period} and when protection needs change, and every person and external party with access to confidential information has a signed agreement that matches the current requirements before access is granted. |
| Parameters (illustrative) | nda_review_period = 24 months |
| Control behaviour | PREVENTIVE |
| Domain group | People |
| Owner role | Head of legal and compliance |
| ISO 27001 Annex A | A.6.6 |
| NIST SP 800-53 Rev. 5 | PS-6 |
| NIS2 Art. 21(2) point (other articles named) | (i) (to verify) |
| Environments (illustrative) | Organization-wide, evidenced by the HR system and the contract register. |

Why each Annex A item maps here:

- **A.6.6 Confidentiality or non-disclosure agreements.** Confidentiality or non-disclosure agreements: the periodic review of the requirements and a signed, current agreement per person or party are both tested.

**Rationale.** Codex review on #225 pointed out that a clause signed at onboarding does not test that agreements are reviewed when protection needs change, nor that external parties sign them. A separate control gives both their own test and owner (legal, who keeps the templates and the contract register).

### CTL-PS-003

**Disciplinary process**

| Field | Value |
| --- | --- |
| Statement | A formal disciplinary process for information security policy violations is approved and communicated to all personnel, and every confirmed violation has a recorded disciplinary decision within {disciplinary_decision_sla}. |
| Parameters (illustrative) | disciplinary_decision_sla = 30 days after the violation is confirmed |
| Control behaviour | CORRECTIVE |
| Domain group | People |
| Owner role | Head of human resources |
| ISO 27001 Annex A | A.6.4 |
| NIST SP 800-53 Rev. 5 | PS-8 |
| NIS2 Art. 21(2) point (other articles named) | (i) (to verify) |
| Environments (illustrative) | Organization-wide (HR case records). |

Why each Annex A item maps here:

- **A.6.4 Disciplinary process.** Disciplinary process: tested by sampling confirmed violations (from incidents under CTL-IR-001 and nonconformities under CTL-CA-001) for a recorded decision.

**Rationale.** Mapping it to CTL-PS-001 only tested that the process is mentioned in signed terms, not that it exists and is applied (Codex review on #225). Sampling confirmed violations tests that it is applied, which is what an auditor asks for.

### CTL-AT-001

**Security awareness and training**

| Field | Value |
| --- | --- |
| Statement | Every person with access to in-scope systems completes security awareness training within {onboarding_training_deadline} of joining and at least every {training_interval}, and staff in roles marked sensitive complete role-based training, with completion above {completion_target}. |
| Parameters (illustrative) | onboarding_training_deadline = 30 days; training_interval = 12 months; completion_target = 95% |
| Control behaviour | PREVENTIVE |
| Domain group | People |
| Owner role | Chief information security officer |
| ISO 27001 Annex A | A.6.3 |
| NIST SP 800-53 Rev. 5 | AT-2; AT-3 |
| NIS2 Art. 21(2) point (other articles named) | (g) |
| Environments (illustrative) | Organization-wide (learning platform). |

Why each Annex A item maps here:

- **A.6.3 IS awareness, education and training.** Awareness, education and training: measurable through completion records.

**Rationale.** A single-item control because no other uncovered item shares its evidence. It maps directly to NIS2 Art. 21(2)(g), which Document F does not cover today.

### CTL-AC-006

**Remote working and remote access**

| Field | Value |
| --- | --- |
| Statement | Remote working follows the remote working rules {remote_working_rules}, and remote access to in-scope systems is allowed only from managed devices that meet the device compliance policy {device_compliance_policy}. |
| Parameters (illustrative) | remote_working_rules = the topic-specific policy on remote working (location, screen privacy, home network, printing); device_compliance_policy = Intune compliance (encryption, OS version, EDR active), enforced by Conditional Access |
| Control behaviour | PREVENTIVE |
| Domain group | Identity and access |
| Owner role | Head of end-user computing (role to define) |
| ISO 27001 Annex A | A.6.7 |
| NIST SP 800-53 Rev. 5 | AC-17; AC-19 |
| NIS2 Art. 21(2) point (other articles named) | (j) (to verify) |
| Environments (illustrative) | SaaS and the Azure columns (Conditional Access device compliance), on-premises (VPN with device check), AWS (access through IAM Identity Center federated to Entra), Legacy (COMPENSATING: VPN plus jump host). |

Why each Annex A item maps here:

- **A.6.7 Remote working.** Remote working: access is conditioned on a compliant device.

**Rationale.** Remote working is mostly enforced through the access conditions for the device. CTL-SI-001 (endpoint protection) was considered, but it tests the agent, not access conditions. Security of assets off-premises (A.7.9) was first grouped here; after review it got its own control (CTL-PE-004), because it also covers paper, media and other equipment, not only managed devices.

## Proposed extensions of Document F controls

### CTL-IR-001

**Incident response handling** (Document F; today maps A.5.24; A.5.25; A.5.26)

| Field | Value |
| --- | --- |
| Statement today | Security incidents are classified, handled and closed under the approved incident process, and the process is exercised at least every {ir_exercise_interval}. |
| Proposed statement | All personnel are required by policy, and told in awareness training, to report observed or suspected security events through {reporting_channel}, reports are acknowledged within {report_ack_sla}, security incidents are classified, handled and closed under the approved incident process, and the process is exercised at least every {ir_exercise_interval}. |
| Added parameters (illustrative) | reporting_channel = the service desk security category and the phishing report button; report_ack_sla = 1 working day |
| Added Annex A | A.6.8 |
| NIST SP 800-53 Rev. 5 | adds IR-6 (to verify: IR-6 also covers external reporting, which CTL-IR-002 holds); IR-7 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | unchanged ((b)) |

Why each Annex A item maps here:

- **A.6.8 Information security event reporting.** Event reporting by personnel is the entry point of the incident process this control already tests (A.5.24 to A.5.26). Reports and their acknowledgement live in the same case tool.

**Rationale.** A separate reporting control would test the first step of a process whose remaining steps are tested here. CTL-AU-002 (monitoring) was considered too, but it handles machine-generated alerts, not reports from people.

## Out of scope

- Any change to the app, the database, the seed, `CONTEXT.md` or the design prototype. If the product owner accepts these proposals, adding them to `public/design/enterprise-library/enterprise-data.js` (so the crosswalk shows no uncovered items) is a separate issue.
- Per-environment cells (party, origin, Stage, tests) for the new controls. They follow once the control-level proposal is accepted.

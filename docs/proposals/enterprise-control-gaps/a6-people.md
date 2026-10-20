# Enterprise Control proposals: A.6 People controls

Follow-up to #219. The Enterprise Control Library proposal (`/design/enterprise-library/proposal-a.html`, from [Document F, Hybrid Control Matrix](https://www.aspa.se/grc/f-hybrid-control-matrix.html)) leaves 62 ISO/IEC 27001:2022 Annex A items without an Enterprise Control. This document proposes how to cover the **7 uncovered A.6 items**: with a new Enterprise Control, or by extending one of Document F's 26. One Enterprise Control may absorb several Annex A items, and every mapping decision has a rationale.

This is a proposal for review by the product owner, not a change to the app, the database or the design prototype. Like Document F, every parameter, owner role, environment note and mapping marked "to verify" is illustrative. The conventions and the questions that apply to all four themes are in [README.md](README.md).

## Summary

- 7 uncovered items in A.6.
- 3 new Enterprise Controls proposed here: CTL-PS-001, CTL-AT-001, CTL-AC-006.
- 1 Document F control extended here: CTL-IR-001.

## Mapping decisions

| Annex A item | Mapped to | Decision | Why |
| --- | --- | --- | --- |
| A.6.1 Screening | [CTL-PS-001](#ctl-ps-001) | New Enterprise Control | Screening, tested at the joiner step before an account is created. |
| A.6.2 Terms and conditions of employment | [CTL-PS-001](#ctl-ps-001) | New Enterprise Control | Terms and conditions are signed at the same step and are the carrier of the other obligations. |
| A.6.3 IS awareness, education and training | [CTL-AT-001](#ctl-at-001) | New Enterprise Control | Awareness, education and training: measurable through completion records. |
| A.6.4 Disciplinary process | [CTL-PS-001](#ctl-ps-001) | New Enterprise Control | The disciplinary process needs to be formalized and communicated. Communication is evidenced through the signed terms; the process document itself is in the policy register of CTL-PM-002. A separate control would have no test of its own. |
| A.6.6 Confidentiality or non-disclosure agreements | [CTL-PS-001](#ctl-ps-001) | New Enterprise Control | A confidentiality clause in the terms covers personnel; external parties sign separate agreements, kept in the same HR or contract record and tested the same way (signed before access). |
| A.6.7 Remote working | [CTL-AC-006](#ctl-ac-006) | New Enterprise Control | Remote working: access is conditioned on a compliant device. |
| A.6.8 Information security event reporting | [CTL-IR-001](#ctl-ir-001) | Extend Document F control | Event reporting by personnel is the entry point of the incident process this control already tests (A.5.24 to A.5.26). Reports and their acknowledgement live in the same case tool. |

## Proposed new Enterprise Controls

### CTL-PS-001

**Personnel screening and terms of employment**

| Field | Value |
| --- | --- |
| Statement | Before access is granted, every employee and contractor has been screened to the level {screening_level} required for their role and has signed terms that state their information security responsibilities, the confidentiality obligation, the acceptable use rules and the disciplinary process. |
| Parameters (illustrative) | screening_level = identity, right to work and references for all; criminal record and credit check for roles marked sensitive |
| Control behaviour | PREVENTIVE |
| Domain group | People |
| Owner role | Head of human resources |
| ISO 27001 Annex A | A.6.1; A.6.2; A.6.4; A.6.6 |
| NIST SP 800-53 Rev. 5 | PS-3; PS-6; PS-7 (to verify); PS-8 |
| NIS2 Art. 21(2) | (i) |
| Environments (illustrative) | Organization-wide, evidenced by the HR system and the joiner step that also triggers CTL-AC-004. |

Why each Annex A item maps here:

- **A.6.1 Screening.** Screening, tested at the joiner step before an account is created.
- **A.6.2 Terms and conditions of employment.** Terms and conditions are signed at the same step and are the carrier of the other obligations.
- **A.6.4 Disciplinary process.** The disciplinary process needs to be formalized and communicated. Communication is evidenced through the signed terms; the process document itself is in the policy register of CTL-PM-002. A separate control would have no test of its own.
- **A.6.6 Confidentiality or non-disclosure agreements.** A confidentiality clause in the terms covers personnel; external parties sign separate agreements, kept in the same HR or contract record and tested the same way (signed before access).

**Rationale.** All four items are evidenced by one record per person at one moment: before the first account is created. The joiner process of CTL-AC-004 is the natural test point (no account without a completed HR record).

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
| NIS2 Art. 21(2) | (g) |
| Environments (illustrative) | Organization-wide (learning platform). |

Why each Annex A item maps here:

- **A.6.3 IS awareness, education and training.** Awareness, education and training: measurable through completion records.

**Rationale.** A single-item control because no other uncovered item shares its evidence. It maps directly to NIS2 Art. 21(2)(g), which Document F does not cover today.

### CTL-AC-006

**Remote working and off-premises devices**

| Field | Value |
| --- | --- |
| Statement | Remote access to in-scope systems is allowed only from managed devices that meet the device compliance policy {device_compliance_policy}, and every managed device used off-premises has full-disk encryption and can be located, locked and wiped remotely. |
| Parameters (illustrative) | device_compliance_policy = Intune compliance (encryption, OS version, EDR active), enforced by Conditional Access |
| Control behaviour | PREVENTIVE |
| Domain group | Identity and access |
| Owner role | Head of end-user computing (role to define) |
| ISO 27001 Annex A | A.6.7; A.7.9 |
| NIST SP 800-53 Rev. 5 | AC-17; AC-19; PE-17 |
| NIS2 Art. 21(2) | (j) (to verify) |
| Environments (illustrative) | SaaS and the Azure columns (Conditional Access device compliance), on-premises (VPN with device check), AWS (access through IAM Identity Center federated to Entra), Legacy (COMPENSATING: VPN plus jump host). |

Why each Annex A item maps here:

- **A.6.7 Remote working.** Remote working: access is conditioned on a compliant device.
- **A.7.9 Security of assets off-premises.** Security of assets off-premises applies to the same laptops and phones, managed by the same tooling and evidenced by the same compliance report. Listed by reference in the A.7 issue.

**Rationale.** Remote working and off-premises equipment are one technical problem today: the managed endpoint outside the office. CTL-SI-001 (endpoint protection) was considered, but it tests the agent, not access conditions or encryption.

## Proposed extensions of Document F controls

### CTL-IR-001

**Incident response handling** (Document F; today maps A.5.24; A.5.25; A.5.26)

| Field | Value |
| --- | --- |
| Statement today | Security incidents are classified, handled and closed under the approved incident process, and the process is exercised at least every {ir_exercise_interval}. |
| Proposed statement | Personnel can report observed or suspected security events through {reporting_channel}, reports are acknowledged within {report_ack_sla}, security incidents are classified, handled and closed under the approved incident process, and the process is exercised at least every {ir_exercise_interval}. |
| Added parameters (illustrative) | reporting_channel = the service desk security category and the phishing report button; report_ack_sla = 1 working day |
| Added Annex A | A.6.8 |
| NIST SP 800-53 Rev. 5 | adds IR-6 (to verify: IR-6 also covers external reporting, which CTL-IR-002 holds); IR-7 (to verify) |
| NIS2 Art. 21(2) | unchanged ((b)) |

Why each Annex A item maps here:

- **A.6.8 Information security event reporting.** Event reporting by personnel is the entry point of the incident process this control already tests (A.5.24 to A.5.26). Reports and their acknowledgement live in the same case tool.

**Rationale.** A separate reporting control would test the first step of a process whose remaining steps are tested here. CTL-AU-002 (monitoring) was considered too, but it handles machine-generated alerts, not reports from people.

## Out of scope

- Any change to the app, the database, the seed, `CONTEXT.md` or the design prototype. If the product owner accepts these proposals, adding them to `public/design/enterprise-library/enterprise-data.js` (so the crosswalk shows no uncovered items) is a separate issue.
- Per-environment cells (party, origin, Stage, tests) for the new controls. They follow once the control-level proposal is accepted.

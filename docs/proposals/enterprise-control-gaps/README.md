# Enterprise Control proposals for uncovered Annex A items

Follow-up to #219. Document F ([Hybrid Control Matrix](https://www.aspa.se/grc/f-hybrid-control-matrix.html)) defines 26 Enterprise Controls that map to 31 of the 93 ISO/IEC 27001:2022 Annex A items. The design proposal for #219 assumes the other 62 stay as Annex A Controls (a hybrid library). These documents propose Enterprise Controls for all 62, one document and one GitHub issue per Annex A theme:

| Theme | Issue | Uncovered items | New controls | Document F controls extended |
| --- | --- | --- | --- | --- |
| [A.5 Organizational controls](a5-organizational.md) | #221 | 23 | 13 | 1 |
| [A.6 People controls](a6-people.md) | #222 | 7 | 3 | 1 |
| [A.7 Physical controls](a7-physical.md) | #223 | 14 | 5 | 0 |
| [A.8 Technological controls](a8-technological.md) | #224 | 18 | 7 | 3 |
| **Total** | | **62** | **28** | **5** |

Result if accepted: 54 Enterprise Controls cover all 93 Annex A items, against 93 base Controls today.

## Conventions

- **Same shape as Document F.** Each proposal has an ID, name, a one-sentence testable statement with `{parameters}`, control behaviour (PREVENTIVE, DETECTIVE, CORRECTIVE, PROACTIVE), domain group, owner role and ISO 27001 / NIST SP 800-53 / NIS2 Art. 21(2) mappings.
- **IDs** are `CTL-<family>-<nnn>`, where `<family>` is the NIST SP 800-53 family of the primary mapping, numbered after Document F's last control in that family (Document F does the same, except for its own `VR` prefix).
- **Grouping rule.** Annex A items share an Enterprise Control when they have the same owner, the same evidence source and one test can decide PASS or FAIL for all of them. Otherwise they get separate controls, even when the topics are related.
- **Extend before adding.** An item goes into an existing Document F control when it is a step of what that control already tests (same trigger, same evidence); its statement is then amended. Otherwise a new control is proposed. Each extension states which alternatives were considered.
- **Each Annex A item maps whole** to exactly one Enterprise Control, so the crosswalk stays one-to-many. Items already mapped by Document F are not touched.
- **Owning issue.** A control that absorbs items from two themes is proposed in the issue of its first item's theme and listed by reference in the other.
- **Illustrative values.** Parameters, owner roles and environment notes are examples, as in Document F. Mappings marked "to verify" have not been checked against the source standard.

## Open questions for the product owner

1. **Organization-wide controls in a per-environment matrix.** Document F's six environment columns fit technical controls. The governance, people and training controls proposed here (CTL-PM-002, CTL-PM-003, CTL-PM-004, CTL-CA-001, CTL-SI-002, CTL-IR-003, CTL-PS-001, CTL-AT-001) have one organization-wide record. Proposal: give them a single "Organization" cell instead of six. Alternative: keep these items as Annex A Controls, as Document F assumes.
2. **Hybrid or full replacement.** With these proposals every one of the 93 Annex A items is covered by 54 Enterprise Controls (26 from Document F, 28 new), and the "uncovered items stay as Annex A Controls" assumption on the crosswalk would go.
3. **Changing Document F's controls.** 5 proposals extend a Document F control's statement and mapping (CTL-AC-004, CTL-IR-001, CTL-AU-001, CTL-CM-004, CTL-VR-002). Document F is an external draft (GERA-006); are these local changes, or fed back to its authors?
4. **New domain groups.** Document F has nine groups. These proposals add four: Governance and assurance, People, Physical and media, Secure development.
5. **Roles to define.** Some owner roles do not exist yet in Document F (head of information management, head of end-user computing).
6. **Physical controls in the cloud columns** are proposed as party P, inherited from the provider and evidenced through CTL-SR-001. Is that acceptable, or should those cells be n/a?

## All mapping decisions

| Annex A item | Enterprise Control | Decision |
| --- | --- | --- |
| A.5.1 Policies for information security | [CTL-PM-002](a5-organizational.md#ctl-pm-002) Information security policy framework | New |
| A.5.2 Information security roles and responsibilities | [CTL-PM-003](a5-organizational.md#ctl-pm-003) Security roles and management accountability | New |
| A.5.3 Segregation of duties | [CTL-AC-005](a5-organizational.md#ctl-ac-005) Role-based access and segregation of duties | New |
| A.5.4 Management responsibilities | [CTL-PM-003](a5-organizational.md#ctl-pm-003) Security roles and management accountability | New |
| A.5.6 Contact with special interest groups | [CTL-SI-002](a5-organizational.md#ctl-si-002) Threat intelligence | New |
| A.5.7 Threat intelligence | [CTL-SI-002](a5-organizational.md#ctl-si-002) Threat intelligence | New |
| A.5.8 Information security in project management | [CTL-SA-001](a5-organizational.md#ctl-sa-001) Security requirements in projects and acquisitions | New |
| A.5.10 Acceptable use of information and other assets | [CTL-PM-002](a5-organizational.md#ctl-pm-002) Information security policy framework | New |
| A.5.11 Return of assets | [CTL-AC-004](a5-organizational.md#ctl-ac-004) Joiner, mover and leaver deprovisioning | Extend |
| A.5.12 Classification of information | [CTL-RA-001](a5-organizational.md#ctl-ra-001) Information classification and labelling | New |
| A.5.13 Labelling of information | [CTL-RA-001](a5-organizational.md#ctl-ra-001) Information classification and labelling | New |
| A.5.14 Information transfer | [CTL-SC-005](a5-organizational.md#ctl-sc-005) Information transfer and data leakage prevention | New |
| A.5.15 Access control | [CTL-AC-005](a5-organizational.md#ctl-ac-005) Role-based access and segregation of duties | New |
| A.5.23 Information security for use of cloud services | [CTL-SR-002](a5-organizational.md#ctl-sr-002) Cloud service responsibility and exit | New |
| A.5.27 Learning from information security incidents | [CTL-IR-003](a5-organizational.md#ctl-ir-003) Post-incident review and evidence handling | New |
| A.5.28 Collection of evidence | [CTL-IR-003](a5-organizational.md#ctl-ir-003) Post-incident review and evidence handling | New |
| A.5.29 Information security during disruption | [CTL-CP-003](a5-organizational.md#ctl-cp-003) Continuity and redundancy of critical systems | New |
| A.5.31 Legal, statutory and regulatory requirements | [CTL-PM-004](a5-organizational.md#ctl-pm-004) Legal, regulatory and contractual obligations | New |
| A.5.32 Intellectual property rights | [CTL-PM-004](a5-organizational.md#ctl-pm-004) Legal, regulatory and contractual obligations | New |
| A.5.33 Protection of records | [CTL-SI-003](a5-organizational.md#ctl-si-003) Records retention and information deletion | New |
| A.5.35 Independent review of information security | [CTL-CA-001](a5-organizational.md#ctl-ca-001) Independent review and compliance checks | New |
| A.5.36 Compliance with policies, rules and standards | [CTL-CA-001](a5-organizational.md#ctl-ca-001) Independent review and compliance checks | New |
| A.5.37 Documented operating procedures | [CTL-PM-002](a5-organizational.md#ctl-pm-002) Information security policy framework | New |
| A.6.1 Screening | [CTL-PS-001](a6-people.md#ctl-ps-001) Personnel screening and terms of employment | New |
| A.6.2 Terms and conditions of employment | [CTL-PS-001](a6-people.md#ctl-ps-001) Personnel screening and terms of employment | New |
| A.6.3 IS awareness, education and training | [CTL-AT-001](a6-people.md#ctl-at-001) Security awareness and training | New |
| A.6.4 Disciplinary process | [CTL-PS-001](a6-people.md#ctl-ps-001) Personnel screening and terms of employment | New |
| A.6.6 Confidentiality or non-disclosure agreements | [CTL-PS-001](a6-people.md#ctl-ps-001) Personnel screening and terms of employment | New |
| A.6.7 Remote working | [CTL-AC-006](a6-people.md#ctl-ac-006) Remote working and off-premises devices | New |
| A.6.8 Information security event reporting | [CTL-IR-001](a6-people.md#ctl-ir-001) Incident response handling | Extend |
| A.7.1 Physical security perimeters | [CTL-PE-001](a7-physical.md#ctl-pe-001) Physical perimeter and entry control | New |
| A.7.2 Physical entry controls | [CTL-PE-001](a7-physical.md#ctl-pe-001) Physical perimeter and entry control | New |
| A.7.3 Securing offices, rooms and facilities | [CTL-PE-001](a7-physical.md#ctl-pe-001) Physical perimeter and entry control | New |
| A.7.4 Physical security monitoring | [CTL-PE-002](a7-physical.md#ctl-pe-002) Physical security monitoring | New |
| A.7.5 Protecting against physical and environmental threats | [CTL-PE-003](a7-physical.md#ctl-pe-003) Facility environment, utilities and equipment | New |
| A.7.6 Working in secure areas | [CTL-PE-001](a7-physical.md#ctl-pe-001) Physical perimeter and entry control | New |
| A.7.7 Clear desk and clear screen | [CTL-AC-007](a7-physical.md#ctl-ac-007) Clear desk and clear screen | New |
| A.7.8 Equipment siting and protection | [CTL-PE-003](a7-physical.md#ctl-pe-003) Facility environment, utilities and equipment | New |
| A.7.9 Security of assets off-premises | [CTL-AC-006](a6-people.md#ctl-ac-006) Remote working and off-premises devices | New |
| A.7.10 Storage media | [CTL-MP-001](a7-physical.md#ctl-mp-001) Storage media and secure disposal | New |
| A.7.11 Supporting utilities | [CTL-PE-003](a7-physical.md#ctl-pe-003) Facility environment, utilities and equipment | New |
| A.7.12 Cabling security | [CTL-PE-003](a7-physical.md#ctl-pe-003) Facility environment, utilities and equipment | New |
| A.7.13 Equipment maintenance | [CTL-PE-003](a7-physical.md#ctl-pe-003) Facility environment, utilities and equipment | New |
| A.7.14 Secure disposal or re-use of equipment | [CTL-MP-001](a7-physical.md#ctl-mp-001) Storage media and secure disposal | New |
| A.8.4 Access to source code | [CTL-SA-003](a8-technological.md#ctl-sa-003) Source code and pipeline protection | New |
| A.8.6 Capacity management | [CTL-CP-004](a8-technological.md#ctl-cp-004) Capacity management | New |
| A.8.10 Information deletion | [CTL-SI-003](a5-organizational.md#ctl-si-003) Records retention and information deletion | New |
| A.8.11 Data masking | [CTL-PT-002](a8-technological.md#ctl-pt-002) Data masking and test data protection | New |
| A.8.12 Data leakage prevention | [CTL-SC-005](a5-organizational.md#ctl-sc-005) Information transfer and data leakage prevention | New |
| A.8.14 Redundancy of information processing facilities | [CTL-CP-003](a5-organizational.md#ctl-cp-003) Continuity and redundancy of critical systems | New |
| A.8.17 Clock synchronisation | [CTL-AU-001](a8-technological.md#ctl-au-001) Centralized security logging | Extend |
| A.8.18 Use of privileged utility programs | [CTL-CM-004](a8-technological.md#ctl-cm-004) Approved software and images | Extend |
| A.8.21 Security of network services | [CTL-SC-006](a8-technological.md#ctl-sc-006) Network service security | New |
| A.8.23 Web filtering | [CTL-SC-007](a8-technological.md#ctl-sc-007) Web filtering | New |
| A.8.25 Secure development life cycle | [CTL-SA-002](a8-technological.md#ctl-sa-002) Secure development lifecycle | New |
| A.8.26 Application security requirements | [CTL-SA-001](a5-organizational.md#ctl-sa-001) Security requirements in projects and acquisitions | New |
| A.8.27 Secure system architecture and engineering principles | [CTL-SA-002](a8-technological.md#ctl-sa-002) Secure development lifecycle | New |
| A.8.28 Secure coding | [CTL-SA-002](a8-technological.md#ctl-sa-002) Secure development lifecycle | New |
| A.8.30 Outsourced development | [CTL-SA-002](a8-technological.md#ctl-sa-002) Secure development lifecycle | New |
| A.8.31 Separation of development, test and production environments | [CTL-CM-005](a8-technological.md#ctl-cm-005) Separation of environments | New |
| A.8.33 Test information | [CTL-PT-002](a8-technological.md#ctl-pt-002) Data masking and test data protection | New |
| A.8.34 Protection of information systems during audit testing | [CTL-VR-002](a8-technological.md#ctl-vr-002) Security testing | Extend |

# Enterprise Control proposals: A.7 Physical controls

Follow-up to #219. The Enterprise Control Library proposal (`/design/enterprise-library/proposal-a.html`, from [Document F, Hybrid Control Matrix](https://www.aspa.se/grc/f-hybrid-control-matrix.html)) leaves 62 ISO/IEC 27001:2022 Annex A items without an Enterprise Control. This document proposes how to cover the **14 uncovered A.7 items**: with a new Enterprise Control, or by extending one of Document F's 26. One Enterprise Control may absorb several Annex A items, and every mapping decision has a rationale.

This is a proposal for review by the product owner, not a change to the app, the database or the design prototype. Like Document F, every parameter, owner role, environment note and mapping marked "to verify" is illustrative. The conventions and the questions that apply to all four themes are in [README.md](README.md).

## Summary

- 14 uncovered items in A.7.
- 8 new Enterprise Controls proposed here: CTL-PE-001, CTL-PE-002, CTL-PE-003, CTL-PE-004, CTL-PE-005, CTL-MA-001, CTL-AC-007, CTL-MP-001.
- 0 Document F controls extended here.

## Mapping decisions

| Annex A item | Mapped to | Decision | Why |
| --- | --- | --- | --- |
| A.7.1 Physical security perimeters | [CTL-PE-001](#ctl-pe-001) | New Enterprise Control | The defined perimeter. |
| A.7.2 Physical entry controls | [CTL-PE-001](#ctl-pe-001) | New Enterprise Control | Entry controls at the perimeter: the badge system and its access list are the main evidence. |
| A.7.3 Securing offices, rooms and facilities | [CTL-PE-001](#ctl-pe-001) | New Enterprise Control | Securing offices, rooms and facilities is the same zoning applied inside the perimeter. |
| A.7.4 Physical security monitoring | [CTL-PE-002](#ctl-pe-002) | New Enterprise Control | Physical security monitoring. |
| A.7.5 Protecting against physical and environmental threats | [CTL-PE-003](#ctl-pe-003) | New Enterprise Control | Protection against physical and environmental threats (fire, flood, temperature). |
| A.7.6 Working in secure areas | [CTL-PE-001](#ctl-pe-001) | New Enterprise Control | Working in secure areas is enforced by the same zone rules (who may enter, escort, no lone working where required) and evidenced by the same access log. |
| A.7.7 Clear desk and clear screen | [CTL-AC-007](#ctl-ac-007) | New Enterprise Control | Clear desk and clear screen: the screen lock is technical and automatable; the clear desk part is a sampled check. |
| A.7.8 Equipment siting and protection | [CTL-PE-003](#ctl-pe-003) | New Enterprise Control | Equipment siting is checked in the same room inspection: placed away from environmental hazards and out of view of unauthorized persons. |
| A.7.9 Security of assets off-premises | [CTL-PE-004](#ctl-pe-004) | New Enterprise Control | Security of assets off-premises: the device part is automatable (compliance report), the other assets are tested by reconciling the off-site record. |
| A.7.10 Storage media | [CTL-MP-001](#ctl-mp-001) | New Enterprise Control | Storage media through their lifecycle: acquisition (approved media only), accountability (recorded owner), storage, transport and use are each in the statement. |
| A.7.11 Supporting utilities | [CTL-PE-003](#ctl-pe-003) | New Enterprise Control | Supporting utilities (power, cooling) are tested on the same schedule as the protection systems and evidenced by the same test reports. |
| A.7.12 Cabling security | [CTL-PE-005](#ctl-pe-005) | New Enterprise Control | Cabling security: protection against interception, interference and damage. Prevention (enclosed routes, locked cabinets, disabled ports) is in the statement, not only detection by inspection. |
| A.7.13 Equipment maintenance | [CTL-MA-001](#ctl-ma-001) | New Enterprise Control | Equipment maintenance: schedule, per-job approval, supervision, the post-maintenance check and the record are all fields of one maintenance log entry, so one sample test covers them. |
| A.7.14 Secure disposal or re-use of equipment | [CTL-MP-001](#ctl-mp-001) | New Enterprise Control | Secure disposal or re-use is the end of the same lifecycle and is evidenced by the same disposal certificates. |

## Proposed new Enterprise Controls

### CTL-PE-001

**Physical perimeter and entry control**

| Field | Value |
| --- | --- |
| Statement | Every site that houses in-scope systems or information has a defined security perimeter and secure areas, entry is restricted to authorized persons by {entry_mechanism}, visitors are escorted, and the access list for secure areas is reviewed at least every {physical_access_review_period}. |
| Parameters (illustrative) | entry_mechanism = badge plus PIN for secure areas, badge for offices; physical_access_review_period = 90 days for secure areas |
| Control behaviour | PREVENTIVE |
| Domain group | Physical and media |
| Owner role | Head of facilities |
| ISO 27001 Annex A | A.7.1; A.7.2; A.7.3; A.7.6 |
| NIST SP 800-53 Rev. 5 | PE-2; PE-3; PE-8 |
| NIS2 Art. 21(2) point (other articles named) | no direct point (the Art. 21(1) all-hazards approach applies) |
| Environments (illustrative) | On-premises and Legacy: C/S. SaaS, Azure and AWS: P, inherited from the provider's data centres and evidenced through CTL-SR-001 (SOC 2 or ISO 27001 reports). |

Why each Annex A item maps here:

- **A.7.1 Physical security perimeters.** The defined perimeter.
- **A.7.2 Physical entry controls.** Entry controls at the perimeter: the badge system and its access list are the main evidence.
- **A.7.3 Securing offices, rooms and facilities.** Securing offices, rooms and facilities is the same zoning applied inside the perimeter.
- **A.7.6 Working in secure areas.** Working in secure areas is enforced by the same zone rules (who may enter, escort, no lone working where required) and evidenced by the same access log.

**Rationale.** Four items share the badge system, the zone model and the facilities owner. The cloud columns show why the hybrid assumption was attractive: there the control is entirely the provider's. Making it an Enterprise Control still works, because Document F's party code P plus inherited evidence expresses exactly that.

### CTL-PE-002

**Physical security monitoring**

| Field | Value |
| --- | --- |
| Statement | Sites that house in-scope systems are monitored for unauthorized entry by {monitoring_mechanism}, and alarms are responded to within {alarm_response_time}. |
| Parameters (illustrative) | monitoring_mechanism = intrusion alarm and CCTV at entry points and secure areas; alarm_response_time = 15 minutes |
| Control behaviour | DETECTIVE |
| Domain group | Physical and media |
| Owner role | Head of facilities |
| ISO 27001 Annex A | A.7.4 |
| NIST SP 800-53 Rev. 5 | PE-6 |
| NIS2 Art. 21(2) point (other articles named) | no direct point (the Art. 21(1) all-hazards approach applies) |
| Environments (illustrative) | On-premises and Legacy: C/S. Cloud columns: P, inherited via CTL-SR-001. |

Why each Annex A item maps here:

- **A.7.4 Physical security monitoring.** Physical security monitoring.

**Rationale.** Kept apart from CTL-PE-001 because its behaviour is DETECTIVE and its test is a response time, not an access list. Document F separates preventive and detective controls the same way (CTL-AC-001 and CTL-AC-003).

### CTL-PE-003

**Environmental protection and supporting utilities**

| Field | Value |
| --- | --- |
| Statement | Equipment rooms that house in-scope systems have equipment sited to reduce environmental risk and unauthorized viewing or access, are protected against fire, water, temperature and power failure, and their protection systems and supporting utilities are tested at least every {utility_test_interval}. |
| Parameters (illustrative) | utility_test_interval = 6 months for UPS and generator, 12 months for fire suppression and cooling |
| Control behaviour | PREVENTIVE |
| Domain group | Physical and media |
| Owner role | Head of facilities |
| ISO 27001 Annex A | A.7.5; A.7.8; A.7.11 |
| NIST SP 800-53 Rev. 5 | PE-10; PE-11; PE-12; PE-13; PE-14; PE-15; PE-18 |
| NIS2 Art. 21(2) point (other articles named) | no direct point (the Art. 21(1) all-hazards approach applies) |
| Environments (illustrative) | On-premises and Legacy: C/S. Cloud columns: P, inherited via CTL-SR-001. |

Why each Annex A item maps here:

- **A.7.5 Protecting against physical and environmental threats.** Protection against physical and environmental threats (fire, flood, temperature).
- **A.7.8 Equipment siting and protection.** Equipment siting is checked in the same room inspection: placed away from environmental hazards and out of view of unauthorized persons.
- **A.7.11 Supporting utilities.** Supporting utilities (power, cooling) are tested on the same schedule as the protection systems and evidenced by the same test reports.

**Rationale.** Three items share one owner, the same rooms and one evidence source (the room inspection and the protection and utility test reports). Cabling security (A.7.12) and equipment maintenance (A.7.13) were first grouped here as well; after review they got their own controls (CTL-PE-005, CTL-MA-001), because a maintenance log does not show that cables are protected against interception or that maintenance is done by authorized people.

### CTL-PE-004

**Assets off-premises**

| Field | Value |
| --- | --- |
| Statement | Assets that hold or process in-scope information (devices, removable media, paper, specialist equipment) are taken off-premises only under the rules {offsite_asset_rules}, which set protection by asset type and by the risk of the location and journey; every managed device used off-premises has full-disk encryption and can be located, locked and wiped remotely, and the record of other assets taken off-site is reconciled at least every {offsite_reconciliation_period}. |
| Parameters (illustrative) | offsite_asset_rules = the topic-specific policy on assets off-premises (authorization for non-standard assets, never left unattended in transit, locked storage); offsite_reconciliation_period = 6 months |
| Control behaviour | PREVENTIVE |
| Domain group | Physical and media |
| Owner role | Head of IT operations |
| ISO 27001 Annex A | A.7.9 |
| NIST SP 800-53 Rev. 5 | PE-17; AC-19; MP-5 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (i) (to verify) |
| Environments (illustrative) | Endpoint fleet (Intune compliance report) and the off-site asset record; n/a for the cloud columns. |

Why each Annex A item maps here:

- **A.7.9 Security of assets off-premises.** Security of assets off-premises: the device part is automatable (compliance report), the other assets are tested by reconciling the off-site record.

**Rationale.** Codex review on #225 noted that mapping A.7.9 to the remote access control (CTL-AC-006) left paper, media and other equipment untested. A separate control covers all asset types, keeps the automatable device check, and leaves remote access conditions in CTL-AC-006.

### CTL-PE-005

**Cabling security**

| Field | Value |
| --- | --- |
| Statement | Power and telecommunications cabling that carries in-scope data or supplies in-scope systems runs in access-controlled areas or in enclosed and secured conduits or ducts (always enclosed and locked in shared or public areas), is separated or shielded where interference is a risk, patch panels and network cabinets are locked, unused network ports are disabled, and cabling is inspected for damage, tampering and unauthorized devices at least every {cabling_inspection_interval}. |
| Parameters (illustrative) | cabling_inspection_interval = 12 months, and after building work |
| Control behaviour | PREVENTIVE |
| Domain group | Physical and media |
| Owner role | Head of network engineering |
| ISO 27001 Annex A | A.7.12 |
| NIST SP 800-53 Rev. 5 | PE-4; PE-9 |
| NIS2 Art. 21(2) point (other articles named) | no direct point (the Art. 21(1) all-hazards approach applies) |
| Environments (illustrative) | On-premises and Legacy: C/S. Cloud columns: P, inherited via CTL-SR-001. |

Why each Annex A item maps here:

- **A.7.12 Cabling security.** Cabling security: protection against interception, interference and damage. Prevention (enclosed routes, locked cabinets, disabled ports) is in the statement, not only detection by inspection.

**Rationale.** Split from CTL-PE-003 after Codex review on #225: the cabling test (protected routes, locked cabinets, inspection for tampering) has nothing in common with utility tests. Owned by network engineering, who run the cabling.

### CTL-MA-001

**Equipment maintenance**

| Field | Value |
| --- | --- |
| Statement | Equipment of in-scope systems is maintained according to the supplier-recommended schedule by authorized personnel or suppliers, each maintenance job is approved beforehand and supervised when done by a supplier on site, affected security controls are checked to work afterwards, every job is recorded with who did what and when, and equipment sent off-site for repair is sanitised first or covered by a confidentiality agreement. |
| Parameters (illustrative) | none |
| Control behaviour | PREVENTIVE |
| Domain group | Physical and media |
| Owner role | Head of IT operations |
| ISO 27001 Annex A | A.7.13 |
| NIST SP 800-53 Rev. 5 | MA-2; MA-5; MA-6 |
| NIS2 Art. 21(2) point (other articles named) | no direct point (the Art. 21(1) all-hazards approach applies) |
| Environments (illustrative) | On-premises and Legacy: C/S. Cloud columns: P, inherited via CTL-SR-001. |

Why each Annex A item maps here:

- **A.7.13 Equipment maintenance.** Equipment maintenance: schedule, per-job approval, supervision, the post-maintenance check and the record are all fields of one maintenance log entry, so one sample test covers them.

**Rationale.** Split from CTL-PE-003 after Codex review on #225. Maintenance applies to all equipment of in-scope systems, not only equipment rooms, and its prefix follows the NIST maintenance family (MA).

### CTL-AC-007

**Clear desk and clear screen**

| Field | Value |
| --- | --- |
| Statement | Managed devices lock the screen after at most {screen_lock_timeout} of inactivity through the configuration baseline, and desks in offices pass the clear desk check run at least every {clear_desk_check_interval}. |
| Parameters (illustrative) | screen_lock_timeout = 10 minutes; clear_desk_check_interval = quarterly, sampled |
| Control behaviour | PREVENTIVE |
| Domain group | Physical and media |
| Owner role | Head of facilities, with the head of end-user computing |
| ISO 27001 Annex A | A.7.7 |
| NIST SP 800-53 Rev. 5 | AC-11; AC-11(1) (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (g) (to verify) |
| Environments (illustrative) | Endpoint fleet (on-premises and Legacy columns as Document F places endpoints); the screen lock is enforced by Intune or Group Policy. |

Why each Annex A item maps here:

- **A.7.7 Clear desk and clear screen.** Clear desk and clear screen: the screen lock is technical and automatable; the clear desk part is a sampled check.

**Rationale.** Mapping it into CTL-CM-001 (configuration baseline) was considered for the screen-lock half, but the clear desk half is not configuration and an Annex A item should map whole. Its prefix follows the primary NIST mapping (AC-11), as the convention requires, while its group is physical.

### CTL-MP-001

**Storage media lifecycle and secure disposal**

| Field | Value |
| --- | --- |
| Statement | Removable storage media are blocked on managed devices except for approved media, which are recorded with an owner, encrypted, stored according to their classification and transported only by the approved means {media_transport_rules}; every storage medium and device holding in-scope information is sanitised to {sanitisation_standard} with a recorded certificate before disposal or re-use. |
| Parameters (illustrative) | media_transport_rules = tracked courier or hand carry, encrypted, logged; sanitisation_standard = NIST SP 800-88 Rev. 1 (clear, purge or destroy according to classification) |
| Control behaviour | PREVENTIVE |
| Domain group | Physical and media |
| Owner role | Head of IT operations |
| ISO 27001 Annex A | A.7.10; A.7.14 |
| NIST SP 800-53 Rev. 5 | MP-2; MP-4; MP-5; MP-6; MP-7 |
| NIS2 Art. 21(2) point (other articles named) | (i) (to verify) |
| Environments (illustrative) | On-premises and Legacy: C/S. Endpoint fleet: removable media block by Intune or Group Policy. Cloud columns: P, inherited via CTL-SR-001 (provider media destruction). |

Why each Annex A item maps here:

- **A.7.10 Storage media.** Storage media through their lifecycle: acquisition (approved media only), accountability (recorded owner), storage, transport and use are each in the statement.
- **A.7.14 Secure disposal or re-use of equipment.** Secure disposal or re-use is the end of the same lifecycle and is evidenced by the same disposal certificates.

**Rationale.** Both items follow one physical medium from use to destruction. Information deletion (A.8.10) was kept out: it is about records in a system, not the device, and is CTL-SI-003. After Codex review on #225 the statement covers the full lifecycle, including recording and transport (NIST MP-5), not only blocking and disposal.

## Out of scope

- Any change to the app, the database, the seed, `CONTEXT.md` or the design prototype. If the product owner accepts these proposals, adding them to `public/design/enterprise-library/enterprise-data.js` (so the crosswalk shows no uncovered items) is a separate issue.
- Per-environment cells (party, origin, Stage, tests) for the new controls. They follow once the control-level proposal is accepted.

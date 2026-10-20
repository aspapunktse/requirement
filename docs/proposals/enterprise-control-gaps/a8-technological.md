# Enterprise Control proposals: A.8 Technological controls

Follow-up to #219. The Enterprise Control Library proposal (`/design/enterprise-library/proposal-a.html`, from [Document F, Hybrid Control Matrix](https://www.aspa.se/grc/f-hybrid-control-matrix.html)) leaves 62 ISO/IEC 27001:2022 Annex A items without an Enterprise Control. This document proposes how to cover the **18 uncovered A.8 items**: with a new Enterprise Control, or by extending one of Document F's 26. One Enterprise Control may absorb several Annex A items, and every mapping decision has a rationale.

This is a proposal for review by the product owner, not a change to the app, the database or the design prototype. Like Document F, every parameter, owner role, environment note and mapping marked "to verify" is illustrative. The conventions and the questions that apply to all four themes are in [README.md](README.md).

## Summary

- 18 uncovered items in A.8.
- 11 new Enterprise Controls proposed here: CTL-SA-002, CTL-SR-003, CTL-SA-003, CTL-CM-005, CTL-SA-004, CTL-PT-002, CTL-CP-004, CTL-CP-005, CTL-SC-006, CTL-SC-007, CTL-CA-002.
- 2 Document F controls extended here: CTL-AU-001, CTL-CM-004.
- 3 items absorbed by a control proposed in another theme: A.8.10, A.8.12, A.8.26.

## Mapping decisions

| Annex A item | Mapped to | Decision | Why |
| --- | --- | --- | --- |
| A.8.4 Access to source code | [CTL-SA-003](#ctl-sa-003) | New Enterprise Control | Access to source code, development tools and software libraries. |
| A.8.6 Capacity management | [CTL-CP-004](#ctl-cp-004) | New Enterprise Control | Capacity management. |
| A.8.10 Information deletion | [CTL-SI-003](a5-organizational.md#ctl-si-003) (proposed in the A.5 document) | New, from another theme | Information deletion is the other end of the same schedule. A retention policy that is never enforced at the end is the most common audit finding, so testing both ends in one control is intended. |
| A.8.11 Data masking | [CTL-PT-002](#ctl-pt-002) | New Enterprise Control | Data masking in line with access control and legal requirements, in production views and in copies. |
| A.8.12 Data leakage prevention | [CTL-SC-005](a5-organizational.md#ctl-sc-005) (proposed in the A.5 document) | New, from another theme | Data leakage prevention is the technical enforcement of the same rules, applied to the same labels. |
| A.8.14 Redundancy of information processing facilities | [CTL-CP-005](#ctl-cp-005) | New Enterprise Control | Redundancy of information processing facilities, scoped by the availability requirement and evidenced by the failover test. |
| A.8.17 Clock synchronisation | [CTL-AU-001](#ctl-au-001) | Extend Document F control | Clock synchronisation matters because logs from different systems must line up. NIST AU-8 (time stamps) sits in the same family as this control's mappings, and the drift is measurable on the log platform the control already tests. |
| A.8.18 Use of privileged utility programs | [CTL-CM-004](#ctl-cm-004) | Extend Document F control | Privileged utility programs are a subset of the software this control already restricts through application allow-listing (NIST CM-7). Adding who may run them uses the same mechanism. |
| A.8.21 Security of network services | [CTL-SC-006](#ctl-sc-006) | New Enterprise Control | Security of network services, in-house and provided. |
| A.8.23 Web filtering | [CTL-SC-007](#ctl-sc-007) | New Enterprise Control | Web filtering. |
| A.8.25 Secure development life cycle | [CTL-SA-002](#ctl-sa-002) | New Enterprise Control | The lifecycle itself. |
| A.8.26 Application security requirements | [CTL-SA-001](a5-organizational.md#ctl-sa-001) (proposed in the A.5 document) | New, from another theme | Application security requirements are the content of the same gate: they are identified when a system is developed or acquired. One gate, one record and one owner cover both, so they share a control. |
| A.8.27 Secure system architecture and engineering principles | [CTL-SA-002](#ctl-sa-002) | New Enterprise Control | Secure architecture and engineering principles are applied at the design review step of the same lifecycle. |
| A.8.28 Secure coding | [CTL-SA-002](#ctl-sa-002) | New Enterprise Control | Secure coding is the build step of the same lifecycle; the pipeline scans are its evidence. |
| A.8.30 Outsourced development | [CTL-SR-003](#ctl-sr-003) | New Enterprise Control | Outsourced development: the organization directs (contract), monitors (supplier review) and accepts (acceptance test) the supplier's work. |
| A.8.31 Separation of development, test and production environments | [CTL-CM-005](#ctl-cm-005) | New Enterprise Control | Separation of development, test and production environments. |
| A.8.33 Test information | [CTL-SA-004](#ctl-sa-004) | New Enterprise Control | Test information: selection (synthetic or masked), protection (access control, exceptions) and management (refresh and deletion) of all test data. |
| A.8.34 Protection of information systems during audit testing | [CTL-CA-002](#ctl-ca-002) | New Enterprise Control | Protection of information systems during audit testing: every assurance activity on operational systems, not only security tests. |

## Proposed new Enterprise Controls

### CTL-SA-002

**Secure development lifecycle**

| Field | Value |
| --- | --- |
| Statement | Every in-scope application and system component developed in-house or by an outsourced developer, including infrastructure as code, platform components, network configuration and firmware, follows the approved secure development lifecycle: its design is reviewed against {architecture_principles} (with a threat model for significant changes), every change is peer reviewed and checked against the secure coding standard by static analysis, dependency and secrets scanning in the pipeline, findings of severity {blocking_severity} block release, and developers complete secure coding training at least every {secure_coding_training_interval}. |
| Parameters (illustrative) | architecture_principles = the approved secure architecture principles; blocking_severity = critical and high; secure_coding_training_interval = 12 months |
| Control behaviour | PREVENTIVE |
| Domain group | Secure development |
| Owner role | Head of software engineering |
| ISO 27001 Annex A | A.8.25; A.8.27; A.8.28 |
| NIST SP 800-53 Rev. 5 | SA-8; SA-11; SA-15; PL-8 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (e) |
| Environments (illustrative) | Azure workload, AWS and on-premises where code is built; SaaS: P (vendor's lifecycle, via CTL-SR-001); Azure platform: infrastructure as code goes through the same pipeline; Legacy: often n/a (no active development) or COMPENSATING. |

Why each Annex A item maps here:

- **A.8.25 Secure development life cycle.** The lifecycle itself.
- **A.8.27 Secure system architecture and engineering principles.** Secure architecture and engineering principles are applied at the design review step of the same lifecycle.
- **A.8.28 Secure coding.** Secure coding is the build step of the same lifecycle; the pipeline scans are its evidence.

**Rationale.** Three items are steps of one pipeline with one owner. CTL-VR-002 (security testing) stays separate: it tests the running application periodically, while this control gates each release. Outsourced development (A.8.30) was first grouped here; after review it got its own control (CTL-SR-003), because overseeing a supplier needs contract and supplier-review evidence, not pipeline evidence.

### CTL-SR-003

**Outsourced development oversight**

| Field | Value |
| --- | --- |
| Statement | Every outsourced development of in-scope software has a contract that sets its security requirements (including the secure development lifecycle of CTL-SA-002), the supplier's development activities are reviewed at least every {supplier_dev_review_period}, and delivered software passes acceptance testing, including security testing, before deployment. |
| Parameters (illustrative) | supplier_dev_review_period = 12 months, and at each major delivery |
| Control behaviour | DETECTIVE |
| Domain group | Supplier and provider assurance |
| Owner role | Head of procurement and vendor risk, with the head of software engineering |
| ISO 27001 Annex A | A.8.30 |
| NIST SP 800-53 Rev. 5 | SA-4; SA-11 (to verify); SR-6 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (d); (e) |
| Environments (illustrative) | Per supplier and System rather than per environment. |

Why each Annex A item maps here:

- **A.8.30 Outsourced development.** Outsourced development: the organization directs (contract), monitors (supplier review) and accepts (acceptance test) the supplier's work.

**Rationale.** Codex review on #225 pointed out that mapping A.8.30 to CTL-SA-002 tested the supplier's pipeline but not the organization's oversight of it. CTL-SR-001 was also considered, but it checks a provider's general assurance report, not a specific development engagement.

### CTL-SA-003

**Source code and pipeline protection**

| Field | Value |
| --- | --- |
| Statement | Read and write access to source repositories, development tools, build pipelines and package, dependency and artifact libraries (internal registries) of every in-scope application and system component (including infrastructure as code, platform, network configuration and firmware) is limited to the people who need it and ends with their engagement, changes to protected branches require review by a second person, commits are scanned for secrets, and access is reviewed at least every {repo_access_review_period}. |
| Parameters (illustrative) | repo_access_review_period = 90 days |
| Control behaviour | PREVENTIVE |
| Domain group | Secure development |
| Owner role | Head of platform engineering |
| ISO 27001 Annex A | A.8.4 |
| NIST SP 800-53 Rev. 5 | CM-5; SA-10 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (e) |
| Environments (illustrative) | Source platform (GitHub or Azure DevOps), which sits under the Azure workload and AWS columns where those build; on-premises source servers; SaaS: n/a. |

Why each Annex A item maps here:

- **A.8.4 Access to source code.** Access to source code, development tools and software libraries.

**Rationale.** Kept apart from CTL-SA-002 because it is an access control on a different system (the source platform) with a different test (permissions and branch protection), and apart from CTL-AC-003 (user access review) because branch protection and second-person review are specific to source code.

### CTL-CM-005

**Separation of environments**

| Field | Value |
| --- | --- |
| Statement | Development, test and production environments of in-scope systems are separated into different subscriptions, accounts or networks with no network path from non-production into production, production credentials are not stored in non-production, changes reach production only through the pipeline's promotion step, and standing access to production for developers is not granted. |
| Parameters (illustrative) | none |
| Control behaviour | PREVENTIVE |
| Domain group | Secure development |
| Owner role | Head of platform engineering |
| ISO 27001 Annex A | A.8.31 |
| NIST SP 800-53 Rev. 5 | SA-3(1); CM-4(1) (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (e) |
| Environments (illustrative) | Azure platform (subscription structure), Azure workload (inherited), AWS (separate accounts), on-premises (network zones), Legacy (often COMPENSATING: shared host with separate instances); SaaS: n/a or vendor sandbox tenant. |

Why each Annex A item maps here:

- **A.8.31 Separation of development, test and production environments.** Separation of development, test and production environments.

**Rationale.** Test data (A.8.33) was considered for this control, since it concerns non-production, but protecting test data is about the data, not the environment, and is CTL-SA-004.

### CTL-SA-004

**Test information**

| Field | Value |
| --- | --- |
| Statement | Test data for in-scope systems is synthetic or masked under CTL-PT-002, real personal or confidential data is used in testing only with an approved exception that includes a data protection impact assessment and production-level access control, access to test data is limited to the project team, and test data is deleted when no longer needed or at least every {test_data_refresh_period}. |
| Parameters (illustrative) | test_data_refresh_period = 6 months |
| Control behaviour | PREVENTIVE |
| Domain group | Secure development |
| Owner role | Head of software engineering |
| ISO 27001 Annex A | A.8.33 |
| NIST SP 800-53 Rev. 5 | SA-3(2); SI-12 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (e) (to verify) |
| Environments (illustrative) | Azure workload, AWS and on-premises test environments; Legacy: often COMPENSATING (approved exception); SaaS: vendor sandbox, often n/a. |

Why each Annex A item maps here:

- **A.8.33 Test information.** Test information: selection (synthetic or masked), protection (access control, exceptions) and management (refresh and deletion) of all test data.

**Rationale.** Split from CTL-PT-002 after Codex review on #225. Its prefix follows the primary NIST mapping (SA-3(2), use of live data). It is owned by engineering, who create and manage test environments, and depends on CTL-PT-002 for the masking standard.

### CTL-PT-002

**Data masking**

| Field | Value |
| --- | --- |
| Statement | Personal and confidential data is masked, pseudonymised or tokenised under the masking standard {masking_standard} wherever a role or environment does not need the real values: in production views and exports, and in every copy made out of production. |
| Parameters (illustrative) | masking_standard = the approved data masking standard (fields to mask per classification, masking technique per field type) |
| Control behaviour | PREVENTIVE |
| Domain group | Data protection and AI |
| Owner role | Data protection officer |
| ISO 27001 Annex A | A.8.11 |
| NIST SP 800-53 Rev. 5 | SA-3(2); SI-19 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | n/a (GDPR Art. 25 and Art. 32 pseudonymisation) |
| Environments (illustrative) | Azure workload, AWS and on-premises where production data is copied; SaaS: vendor features (often n/a); Legacy: often COMPENSATING (synthetic data or approved exception). |

Why each Annex A item maps here:

- **A.8.11 Data masking.** Data masking in line with access control and legal requirements, in production views and in copies.

**Rationale.** One masking standard serves production views and copies. Test information (A.8.33) was first grouped here; Codex review on #225 pointed out that test data can be created or imported without ever being copied from production, and must also be access-controlled and deleted, so it is now CTL-SA-004, which uses this masking standard. The prefix follows Document F's use of PT for personal data protection (CTL-PT-001).

### CTL-CP-004

**Capacity management**

| Field | Value |
| --- | --- |
| Statement | Resource use of in-scope systems is monitored against thresholds set at {capacity_threshold}, alerts are acted on within {capacity_alert_sla}, and capacity forecasts are reviewed at least every {capacity_review_period}. |
| Parameters (illustrative) | capacity_threshold = 80% sustained for CPU, memory, storage and licences; capacity_alert_sla = 5 working days; capacity_review_period = 6 months |
| Control behaviour | DETECTIVE |
| Domain group | Resilience |
| Owner role | Head of IT operations |
| ISO 27001 Annex A | A.8.6 |
| NIST SP 800-53 Rev. 5 | CP-2(2); SC-5(2) (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (c) (to verify) |
| Environments (illustrative) | Azure platform and workload (Azure Monitor), AWS (CloudWatch), on-premises (monitoring platform), Legacy (often manual); SaaS: P (vendor), licence capacity C. |

Why each Annex A item maps here:

- **A.8.6 Capacity management.** Capacity management.

**Rationale.** Considered for CTL-CP-005 (redundancy), but capacity is a continuous monitoring control on every in-scope system, while redundancy is scoped to the high-availability systems and tested by failover.

### CTL-CP-005

**Redundancy of information processing facilities**

| Field | Value |
| --- | --- |
| Statement | Every in-scope system with availability class {availability_class} or higher runs with redundancy that meets its availability requirement (zone or region redundancy, clustering, health-checked load balancing), and its failover is tested at least every {failover_test_interval}. |
| Parameters (illustrative) | availability_class = high; failover_test_interval = 12 months |
| Control behaviour | PROACTIVE |
| Domain group | Resilience |
| Owner role | Head of IT operations |
| ISO 27001 Annex A | A.8.14 |
| NIST SP 800-53 Rev. 5 | CP-7; SC-36 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (c) |
| Environments (illustrative) | Azure workload and AWS (zone or region redundancy), on-premises (second site or cluster), Azure platform (hub redundancy, inherited); SaaS: P, inherited via CTL-SR-001; Legacy: often COMPENSATING (manual fallback). |

Why each Annex A item maps here:

- **A.8.14 Redundancy of information processing facilities.** Redundancy of information processing facilities, scoped by the availability requirement and evidenced by the failover test.

**Rationale.** Split from CTL-CP-003 after Codex review on #225. Redundancy is only required where the availability requirement asks for it, while security during disruption applies to every system, so they need different populations.

### CTL-SC-006

**Network service security**

| Field | Value |
| --- | --- |
| Statement | Every network service used by in-scope systems, provided or in-house (connectivity, DNS, DDoS protection, VPN, firewall service, service-to-service connections), has documented security requirements and service levels, the security features required by {network_service_baseline} are enabled and monitored, and connections to and from these services are authenticated and protected with current, protocol-appropriate encryption: TLS {min_tls} or higher for APIs, databases, message queues and other TLS-capable services, and the equivalent for other protocols (for example IPsec or WireGuard for VPN, DNS over TLS or DNSSEC for DNS). |
| Parameters (illustrative) | network_service_baseline = DDoS protection on internet-facing endpoints, protective DNS, provider security report reviewed yearly; min_tls = 1.2 (as CTL-SC-001) |
| Control behaviour | PREVENTIVE |
| Domain group | Protection |
| Owner role | Head of network engineering |
| ISO 27001 Annex A | A.8.21 |
| NIST SP 800-53 Rev. 5 | SA-9; SC-5; SC-20 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | to verify |
| Environments (illustrative) | Azure platform (hub network services, inherited by workloads), AWS, on-premises (WAN and internet providers); SaaS: P. |

Why each Annex A item maps here:

- **A.8.21 Security of network services.** Security of network services, in-house and provided.

**Rationale.** Considered for CTL-SC-002 (segmentation), which tests rules between zones, not the services themselves; and for CTL-SR-001, which tests provider assurance but not whether the required features are enabled. A new control was needed.

### CTL-SC-007

**Web filtering**

| Field | Value |
| --- | --- |
| Statement | Web access from managed devices to the categories and indicators listed in {web_filter_policy} is blocked on and off the corporate network, every in-scope server (production and non-production, including build agents) reaches the internet only through egress filtering, with production limited to allowlisted destinations and unexpected outbound connections alerted, and the block list is updated from threat intelligence within {web_filter_update_age}. |
| Parameters (illustrative) | web_filter_policy = malicious, newly registered and uncategorised domains, plus categories set by policy; web_filter_update_age = 24 hours |
| Control behaviour | PREVENTIVE |
| Domain group | Protection |
| Owner role | Head of network engineering |
| ISO 27001 Annex A | A.8.23 |
| NIST SP 800-53 Rev. 5 | SC-7 (to verify: SC-7(8)); SI-3 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | (g) (to verify) |
| Environments (illustrative) | Endpoint fleet and on-premises (secure web gateway or endpoint network protection), Azure platform and AWS (egress firewall for servers); SaaS: n/a. |

Why each Annex A item maps here:

- **A.8.23 Web filtering.** Web filtering.

**Rationale.** Extending CTL-SI-001 (endpoint protection) was considered, since many endpoint agents now filter web traffic, but filtering for servers runs at the egress firewall, outside that control. A new control keeps the test independent of the product used.

### CTL-CA-002

**Protection of systems during audit testing**

| Field | Value |
| --- | --- |
| Statement | Every audit test and other assurance activity on in-scope operational systems (including security tests, auditor queries and assessment tools) runs under a plan agreed with the system owner before it starts, uses dedicated, time-limited and read-only access where possible, schedules tests that can affect availability in an agreed window, is logged and its activity log kept after the audit for {audit_log_retention}, and has its access removed when it ends. |
| Parameters (illustrative) | audit_log_retention = 12 months |
| Control behaviour | PREVENTIVE |
| Domain group | Governance and assurance |
| Owner role | Head of internal audit |
| ISO 27001 Annex A | A.8.34 |
| NIST SP 800-53 Rev. 5 | CA-2 (to verify); CA-8 (rules of engagement for penetration tests) |
| NIS2 Art. 21(2) point (other articles named) | (f) (to verify) |
| Environments (illustrative) | Per System, whatever the environment; evidenced by test plans and access records. |

Why each Annex A item maps here:

- **A.8.34 Protection of information systems during audit testing.** Protection of information systems during audit testing: every assurance activity on operational systems, not only security tests.

**Rationale.** First proposed as an extension of CTL-VR-002 (security testing). Codex review on #225 noted that its population is application security tests, so an auditor querying a production database was not covered. A separate control, owned by internal audit, covers all assurance work and still applies to the tests of CTL-VR-002.

## Proposed extensions of Document F controls

### CTL-AU-001

**Centralized security logging** (Document F; today maps A.8.15)

| Field | Value |
| --- | --- |
| Statement today | Security-relevant events of every in-scope system are sent to the central log platform within {log_latency} and retained for {log_retention} with integrity protection. |
| Proposed statement | Security-relevant events of every in-scope system are sent to the central log platform within {log_latency} with timestamps synchronised to {time_source} within {max_clock_drift}, and retained for {log_retention} with integrity protection. |
| Added parameters (illustrative) | time_source = the approved NTP hierarchy (provider time service in cloud); max_clock_drift = 1 second |
| Added Annex A | A.8.17 |
| NIST SP 800-53 Rev. 5 | adds AU-8; SC-45 (to verify) |
| NIS2 Art. 21(2) point (other articles named) | unchanged (to verify) |

Why each Annex A item maps here:

- **A.8.17 Clock synchronisation.** Clock synchronisation matters because logs from different systems must line up. NIST AU-8 (time stamps) sits in the same family as this control's mappings, and the drift is measurable on the log platform the control already tests.

**Rationale.** CTL-CM-001 (configuration baseline) was considered, since NTP is a configuration setting. Placing it here instead tests the outcome (consistent timestamps) rather than a setting, and covers systems that are not under the baseline, such as SaaS logs.

### CTL-CM-004

**Approved software and images** (Document F; today maps A.8.19)

| Field | Value |
| --- | --- |
| Statement today | Only software and machine images from the approved catalog {approved_catalog} run on in-scope systems. |
| Proposed statement | Only software and machine images from the approved catalog {approved_catalog} run on in-scope systems, and utility programs that can override system or application controls are not installed by default, can be run only by {privileged_utility_groups} with separate elevated credentials, and every use is logged. |
| Added parameters (illustrative) | privileged_utility_groups = named administrator groups per platform |
| Added Annex A | A.8.18 |
| NIST SP 800-53 Rev. 5 | adds AC-6 (to verify: AC-6(10)) |
| NIS2 Art. 21(2) point (other articles named) | unchanged (to verify) |

Why each Annex A item maps here:

- **A.8.18 Use of privileged utility programs.** Privileged utility programs are a subset of the software this control already restricts through application allow-listing (NIST CM-7). Adding who may run them uses the same mechanism.

**Rationale.** CTL-AC-001 (privileged access) was considered, since utilities run under privileged accounts, but it controls who is privileged, not which tools they can run. The allow-listing mechanism is where the restriction is enforced.

## Items absorbed by controls proposed in another theme

- **A.8.10 Information deletion** → CTL-SI-003 Records retention and information deletion (see [a5-organizational.md](a5-organizational.md#ctl-si-003)). Information deletion is the other end of the same schedule. A retention policy that is never enforced at the end is the most common audit finding, so testing both ends in one control is intended. Listed by reference in the A.8 issue.
- **A.8.12 Data leakage prevention** → CTL-SC-005 Information transfer and data leakage prevention (see [a5-organizational.md](a5-organizational.md#ctl-sc-005)). Data leakage prevention is the technical enforcement of the same rules, applied to the same labels. Listed by reference in the A.8 issue.
- **A.8.26 Application security requirements** → CTL-SA-001 Security requirements in projects and acquisitions (see [a5-organizational.md](a5-organizational.md#ctl-sa-001)). Application security requirements are the content of the same gate: they are identified when a system is developed or acquired. One gate, one record and one owner cover both, so they share a control. Listed by reference in the A.8 issue.

## Out of scope

- Any change to the app, the database, the seed, `CONTEXT.md` or the design prototype. If the product owner accepts these proposals, adding them to `public/design/enterprise-library/enterprise-data.js` (so the crosswalk shows no uncovered items) is a separate issue.
- Per-environment cells (party, origin, Stage, tests) for the new controls. They follow once the control-level proposal is accepted.

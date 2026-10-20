/* Enterprise Control Library: example data for the design proposal.
   Source: "F. Hybrid Control Matrix" (GERA-006, draft of 2026-10-08), https://www.aspa.se/grc/f-hybrid-control-matrix.html
   - Control-level fields: section 4.2 (catalog) and section 4.3 (framework mappings, including the "to verify" marks).
   - Matrix cells: section 5 (compact codes, kept verbatim in `overview`) and section 6 (per-environment records).
   - Environments: section 2.1. Stage scale: section 2.4.
   Every Stage, status, mechanism, owner role and identifier is ILLUSTRATIVE, as the document itself states (its section 7.1:
   "Illustrative - replace with the organisation's assessment"). Nothing here is the state of a real organization.
   Fields the document gives only as stated defaults (target_type, observability, operation_automation,
   response_automation, overlay) are NOT stored here; the page derives them from the document's rule in section 6 and
   labels them illustrative. Extracted from the published page. */
window.ENTERPRISE = {
 "environments": [
  {
   "key": "SAAS",
   "short": "SaaS",
   "label": "SaaS",
   "covers": "Tenants of software-as-a-service products, with Microsoft 365 as the reference tenant and a generic business SaaS as the variant",
   "targetTypes": "SYSTEM, PROVIDER",
   "mechanisms": "Entra single sign-on, Conditional Access, vendor RBAC, vendor audit API, provider SOC 2 and ISO/IEC 27001 evidence"
  },
  {
   "key": "AZP",
   "short": "AzPlat",
   "label": "Azure platform landing zone",
   "covers": "Management groups, hub network, identity, central logging and policy: a shared implementation platform whose controls are COMMON and inherited by workloads (A §13, B §44)",
   "targetTypes": "CLOUD_LANDING_ZONE, SERVICE",
   "mechanisms": "Entra PIM, Azure Policy, Defender for Cloud, Log Analytics and Sentinel, Key Vault, Azure Backup"
  },
  {
   "key": "AZW",
   "short": "AzWkld",
   "label": "Azure workload (application) landing zone",
   "covers": "A workload subscription that inherits the platform and adds application-specific controls",
   "targetTypes": "SYSTEM, COMPONENT",
   "mechanisms": "Inherited policy, managed identities, IaC modules, pipeline gates"
  },
  {
   "key": "AWS",
   "short": "AWS",
   "label": "AWS",
   "covers": "The organization landing zone and workload accounts, in one column in this version (open decision F2)",
   "targetTypes": "CLOUD_LANDING_ZONE, SYSTEM",
   "mechanisms": "IAM Identity Center, service control policies, AWS Config, Security Hub, CloudTrail, KMS"
  },
  {
   "key": "ONP",
   "short": "OnPrem",
   "label": "On-premises",
   "covers": "Data-center and campus infrastructure under Active Directory",
   "targetTypes": "SYSTEM, COMPONENT",
   "mechanisms": "Active Directory tiering, Group Policy, EDR, enterprise scanner, SIEM forwarding, backup platform"
  },
  {
   "key": "LEG",
   "short": "Legacy",
   "label": "Legacy",
   "covers": "Systems that cannot meet the control as specified (unsupported platforms, no MFA, no API); the cell often holds a compensating implementation",
   "targetTypes": "SYSTEM",
   "mechanisms": "Jump server, network isolation, manual review, virtual patching"
  }
 ],
 "stages": [
  {
   "n": 0,
   "name": "Documented",
   "when": "The implementation exists only in documents or spreadsheets",
   "evidence": "Document reference"
  },
  {
   "n": 1,
   "name": "Structured",
   "when": "The implementation is a record in the control catalog with owner, parameter values and mappings",
   "evidence": "IMP-… record, TST-… defined"
  },
  {
   "n": 2,
   "name": "Connected",
   "when": "Evidence is collected from the source through a connector (assurance automation at least AAL1)",
   "evidence": "Evidence source, maximum_age met"
  },
  {
   "n": 3,
   "name": "Tested",
   "when": "The test is evaluated automatically (AAL2 or higher) and produces a test result",
   "evidence": "Test executions with UNKNOWN handled"
  },
  {
   "n": 4,
   "name": "Automated",
   "when": "The definition is enforced from Git by policy-as-code and pipeline validation",
   "evidence": "Policy and pipeline in Git"
  },
  {
   "n": 5,
   "name": "Continuous",
   "when": "Evaluation is continuous or event-driven (AAL3) with reconciliation",
   "evidence": "Event-driven executions"
  },
  {
   "n": 6,
   "name": "Preventive",
   "when": "Preventive enforcement and approved automated remediation operate",
   "evidence": "Guardrail tests, retest loop"
  }
 ],
 "controls": [
  {
   "id": "CTL-AC-001",
   "name": "Privileged access protection",
   "statement": "Privileged access is granted only to authorized individuals, is time-bound, requires phishing-resistant authentication, and is reviewed at least every {review_period}.",
   "behavior": "PREVENTIVE",
   "owner": "Head of identity and access management",
   "firstM": "M2",
   "domainGroup": "Identity and access",
   "parameters": null,
   "iso": "A.8.2",
   "nist": "AC-6; AC-2 (to verify: AC-2(7))",
   "nis2": "(i); (j)",
   "annexA": [
    {
     "code": "A.8.2",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/H 2>3",
    "AZP": "C/S 3>5",
    "AZW": "C/H 2>4",
    "AWS": "C/S 1>3",
    "ONP": "C/S 1>3",
    "LEG": "C/S* 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-003",
      "party": "SHARED_DEPENDENT",
      "origin": "HYBRID",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "targetType": "SYSTEM; SYS-M365-001 (illustrative)",
     "observability": "OBSERVABLE (customer side); NOT_OBSERVABLE (Microsoft operator access)",
     "mechanism": "Microsoft 365: Entra directory roles through PIM (eligible, time-bound, activation needs approval and MFA); Conditional Access requires authentication_strength; Microsoft-side administrator access to the service is provider-controlled",
     "test": {
      "id": "TST-AC-002",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "standing assignment or weaker strength",
      "unknown": "Graph read fails or the role list is incomplete",
      "pass": "every admin role assignment has an approved owner, is time-bound and is covered by Conditional Access at the required strength"
     },
     "opAuto": "SEMI_AUTOMATED",
     "respAuto": "FINDING_AUTO_CREATED",
     "evidence": "Customer side: Microsoft Graph role schedules and Conditional Access policies (SRC-GRAPH-001). Provider side: Microsoft SOC 2 Type 2 report and ISO/IEC 27001 certificate from the Service Trust Portal, linked to the provider-side responsibility (evidence_confidence LOW alone)",
     "maxAge": "P1D (customer config); P365D (provider reports)",
     "stageNow": 2,
     "stageTarget": 3,
     "linkage": "inherited_from_implementation_id = IMP-AC-001 (platform part)",
     "notes": "The PROVIDER share is not tested by the customer. The Entra platform service is the COMMON part, tenant policy the SYSTEM_SPECIFIC part (0.3 section 5.10 worked row); the COMMON part inherits from IMP-AC-001.",
     "full": true
    },
    "AZP": {
     "env": "AZP",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-001",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "targetType": "SERVICE; SVC-ENTRA-001",
     "observability": "OBSERVABLE",
     "mechanism": "Microsoft Entra PIM for Azure RBAC at management-group and subscription scope; Conditional Access with phishing-resistant authentication strength; break-glass accounts excluded, monitored and alerting; access reviews every review_period",
     "test": {
      "id": "TST-AC-001",
      "method": "TEST",
      "aalNow": "AAL2",
      "aalDesigned": "AAL3",
      "fail": "any assignment fails a clause (EXE-2026-009812: 3 of 250 accounts FAIL)",
      "unknown": "Graph or Resource Graph read incomplete",
      "pass": "every privileged role assignment is eligible and time-bound, has an approved owner, is covered by Conditional Access at the required strength and was reviewed within review_period"
     },
     "opAuto": "SEMI_AUTOMATED",
     "respAuto": "TICKET_AUTO_CREATED",
     "evidence": "Microsoft Graph (SRC-GRAPH-001 via CONN-ENTRA-001) and Azure Resource Graph role assignments; access review records",
     "maxAge": "P1D",
     "stageNow": 3,
     "stageTarget": 5,
     "linkage": "none",
     "notes": "Canonical implementation IMP-AC-001, test TST-AC-001 v3.0. A cloud administrator without MFA is a finding (FND-2026-000789) with an action (ACT-2026-000001), not an exception.",
     "full": true
    },
    "AZW": {
     "env": "AZW",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-004",
      "party": "CUSTOMER",
      "origin": "HYBRID",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "targetType": "SYSTEM; SYS-APP-001 (illustrative)",
     "observability": "OBSERVABLE",
     "mechanism": "Inherits PIM and Conditional Access from the landing-zone identity platform; workload adds subscription-scoped custom roles, managed identities instead of keys and an Azure Policy deny on standing Owner assignments",
     "test": {
      "id": "TST-AC-003",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "standing human assignment or inheritance not valid",
      "unknown": "subscription not in inventory or policy state unavailable",
      "pass": "inheritance verified (correct tenant, subscription, policy assignment) and no standing Owner or Contributor assignment to a human identity"
     },
     "opAuto": "SEMI_AUTOMATED",
     "respAuto": "TICKET_AUTO_CREATED",
     "evidence": "Azure Resource Graph role assignments; Azure Policy compliance state; inheritance verification record (C §48)",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4,
     "linkage": "inherited_from_implementation_id = IMP-AC-001",
     "notes": "PARTIAL until the workload RBAC test runs for every in-scope subscription. Inheritance does not by itself make the workload compliant.",
     "full": true
    },
    "AWS": {
     "env": "AWS",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IN_PROGRESS"
     },
     "targetType": "CLOUD_LANDING_ZONE; SYS-AWSLZ-001 (illustrative)",
     "observability": "OBSERVABLE",
     "mechanism": "AWS IAM Identity Center federated to Entra with phishing-resistant sign-in; permission sets with time-bound elevated sessions and approval; service control policies deny root-user use and IAM-user creation; root accounts hold hardware MFA",
     "test": {
      "id": "TST-AC-004",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "any clause not met",
      "unknown": "an organization account cannot be read",
      "pass": "no standing administrator permission set assignment, no IAM users, root MFA enabled, all elevated sessions time-bound"
     },
     "opAuto": "SEMI_AUTOMATED",
     "respAuto": "NONE",
     "evidence": "AWS Organizations, IAM Identity Center and IAM Access Analyzer via API; AWS Config rule results",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 3,
     "linkage": "none",
     "notes": "Evidence collected by script; the automated test is the M3 deliverable for AWS.",
     "full": true
    },
    "ONP": {
     "env": "ONP",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "targetType": "SYSTEM; SYS-AD-001 (illustrative)",
     "observability": "OBSERVABLE",
     "mechanism": "Active Directory tiering (Tier 0, 1, 2) with privileged access workstations; privileged groups restricted to named accounts, smartcard or FIDO2 sign-in; LAPS for local administrators; membership compared with the approved list",
     "test": {
      "id": "TST-AC-005",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unapproved member or password-only privileged account",
      "unknown": "domain controller unreachable or collection partial",
      "pass": "membership of every privileged group equals the approved list and each member is smartcard or FIDO2 enforced"
     },
     "opAuto": "SEMI_AUTOMATED",
     "respAuto": "NONE",
     "evidence": "AD group membership and account attributes through an outbound-only collector (LDAP or PowerShell); approved list in the control repository",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 3,
     "linkage": "none",
     "notes": "Daily comparison per A §16; the manual run today is AAL0.",
     "full": true
    },
    "LEG": {
     "env": "LEG",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PARTIAL"
     },
     "targetType": "SYSTEM; SYS-ERP-001 (illustrative)",
     "observability": "NOT_OBSERVABLE (native ERP authentication)",
     "mechanism": "Legacy ERP cannot enforce MFA natively: privileged access only through a hardened jump server with phishing-resistant MFA, network isolation to the jump server, session logging and a quarterly manual review of privileged accounts",
     "test": {
      "id": "TST-AC-006",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "direct privileged login or a missing log or review",
      "unknown": "logs not obtainable",
      "pass": "all privileged sessions originate from the jump server, session logs exist for 100% of sessions in the sample and the quarterly review is signed within review_period"
     },
     "opAuto": "MANUAL",
     "respAuto": "NONE",
     "evidence": "Jump-server session logs; firewall rules; signed review record; jump-server MFA configuration",
     "maxAge": "P90D",
     "stageNow": 1,
     "stageTarget": 2,
     "linkage": "compensates_for_implementation_id = IMP-AC-007 (proposed)",
     "notes": "Exception EXC-2026-000007 on IMP-AC-002 (expires 2027-06-30) with DEC-2026-000015 (RISK_ACCEPTED); result stays FAIL with overlay = EXCEPTION_ACTIVE. compensates_for_implementation_id names the deficient native implementation (proposed IMP-AC-007, see section 11.1, G7).",
     "full": true
    }
   },
   "canonical": {
    "Control objective": "CO-AC-001: Prevent misuse of administrative privilege.",
    "Statement": "Privileged access is granted only to authorized individuals, is time-bound, requires phishing-resistant authentication, and is reviewed at least every {review_period}.",
    "Parameters": "review_period = 90 days; authentication_strength = phishing-resistant",
    "control_behavior": "PREVENTIVE",
    "Requirements and mapping": "REQ-NIST171R3-03.01.06 (privileged accounts, NIST SP 800-171 Rev. 3); REQ-CMMC-AC.L2-3.1.5 (Rev. 2 numbering, as CMMC Level 2 uses Rev. 2); MAP-0001 maps the requirement to CTL-AC-001. ISO/IEC 27001:2022 A.8.2; NIST SP 800-53 Rev. 5 AC-6 (and AC-2, to verify AC-2(7)); NIS2 Art. 21(2) (i) and (j)",
    "Risk": "RS-042; observed RSK-2026-000042",
    "Owner role; first milestone": "Head of identity and access management; M2",
    "Canonical trace": "TST-AC-001 v3.0; EXE-2026-009812 (247 PASS, 3 FAIL of 250 accounts; aggregate FAIL); FND-2026-000789; ACT-2026-000001 (enforce MFA on the failing accounts within 7 days, then retest); EXC-2026-000007 on IMP-AC-002, expires 2027-06-30, with DEC-2026-000015 (RISK_ACCEPTED)"
   },
   "canonicalNote": "How the six cells relate. IMP-AC-001 (Microsoft Entra ID, SYSTEM_SPECIFIC, IMPLEMENTED) is placed in the Azure platform column; 0.3 does not say which environment it belongs to (section 11.1). IMP-AC-003 (SaaS, SHARED_DEPENDENT) is the Microsoft 365 tenant and inherits the Entra platform service from IMP-AC-001. IMP-AC-004 (Azure workload) inherits from IMP-AC-001. IMP-AC-005 (AWS) and IMP-AC-006 (on-premises) are independent. IMP-AC-002 (legacy ERP, approach = COMPENSATING, PARTIAL) is the exception: the primary implementation (native ERP authentication) cannot meet the statement, so a compensating implementation with its own evidence and test replaces it, and the exception belongs to this branch only. A cloud administrator without MFA is a finding with an action, not an exception."
  },
  {
   "id": "CTL-IA-001",
   "name": "Multi-factor authentication",
   "statement": "Every interactive user sign-in to an in-scope system requires at least {mfa_factors} authentication factors, and administrator sign-in uses phishing-resistant methods.",
   "behavior": "PREVENTIVE",
   "owner": "Head of identity and access management",
   "firstM": "M3",
   "domainGroup": "Identity and access",
   "parameters": "mfa_factors = 2.",
   "iso": "A.8.5",
   "nist": "IA-2 (to verify: IA-2(1), IA-2(2))",
   "nis2": "(j)",
   "annexA": [
    {
     "code": "A.8.5",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 1>3",
    "AZP": "C/S 2>5",
    "AZW": "C/C 1>3",
    "AWS": "C/S 1>3",
    "ONP": "C/S 0>2",
    "LEG": "C/S* 0>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Business SaaS tenants federated to Entra single sign-on; local logins disabled; MFA enforced by Conditional Access; where SSO is unsupported, vendor-native MFA enforced",
     "notes": "SHARED_DEPENDENT: the customer part depends on the vendor offering SSO or MFA. Vendors without an API give UNKNOWN (NO_COLLECTOR) until manual evidence is accepted.",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-001",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-IA-001",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "any user can sign in without a second factor",
      "unknown": "the SaaS API does not expose the setting",
      "pass": "SSO enforced and local password login disabled, or vendor MFA enforced for all users"
     },
     "evidence": "Entra sign-in logs and enterprise-application configuration; vendor admin API where available; provider SOC 2 report for vendor-side authentication",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Entra Conditional Access: MFA for all users, phishing-resistant strength for administrators; legacy authentication blocked; security defaults off, policies deployed from Git",
     "notes": "Test must check enforcement (M2 gate), not mere policy registration.",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-IA-002",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL3",
      "fail": "user or application excluded without approval",
      "unknown": "policy list incomplete",
      "pass": "a Conditional Access policy requires MFA for all users and no excluded user other than monitored break-glass accounts"
     },
     "evidence": "Microsoft Graph Conditional Access policies and sign-in logs (SRC-GRAPH-001)",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 5
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Workload applications use Entra authentication only (no local accounts); inherits the Conditional Access policies",
     "notes": "inherited_from_implementation_id = IMP-IA-002.",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-003",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-IA-003",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "local or key-based user login exists",
      "unknown": "application inventory incomplete",
      "pass": "every in-scope application registration uses Entra sign-in and is covered by the MFA policy"
     },
     "evidence": "Entra enterprise applications; Conditional Access policy targeting; application registration list",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "IAM Identity Center with Entra as identity provider and MFA enforced; no IAM users with console passwords",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IN_PROGRESS"
     },
     "test": {
      "id": "TST-IA-004",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "IAM console user without MFA",
      "unknown": "account not readable",
      "pass": "Identity Center MFA enforced and zero IAM users with console access"
     },
     "evidence": "IAM credential report; Identity Center configuration via API",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "AD sign-in with MFA for VPN, remote desktop and administrator logon (smartcard or an on-premises MFA agent); internal user logon to servers by password with compensating network controls",
     "notes": "Largely documented only today.",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IA-005",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "remote or administrator logon without MFA",
      "unknown": "configuration export older than maximum_age",
      "pass": "MFA enforced on remote access and administrator logon per configuration export"
     },
     "evidence": "VPN and RADIUS configuration exports; AD authentication policy silos; EDR logon telemetry",
     "maxAge": "P30D",
     "stageNow": 0,
     "stageTarget": 2
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Compensating: access through the jump server of CTL-AC-001; direct application login restricted to the jump-server address",
     "notes": "Shares its compensating mechanism with CTL-AC-001; one exception covers the legacy branch only if a Decision names this implementation as well.",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-IA-006",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "other source address permitted",
      "unknown": "firewall export older than maximum_age",
      "pass": "firewall rules allow application login only from the jump server"
     },
     "evidence": "Firewall rule export; jump-server MFA configuration",
     "maxAge": "P90D",
     "stageNow": 0,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-AC-002",
   "name": "Inactive account management",
   "statement": "Accounts without a sign-in for {inactivity_period} are disabled within {disable_sla} and removed after {removal_period}.",
   "behavior": "DETECTIVE",
   "owner": "Head of identity and access management",
   "firstM": "M3",
   "domainGroup": "Identity and access",
   "parameters": "inactivity_period = 90 days; disable_sla = 7 days; removal_period = 180 days.",
   "iso": "A.5.18",
   "nist": "AC-2 (to verify: AC-2(3))",
   "nis2": "(i)",
   "annexA": [
    {
     "code": "A.5.18",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 1>3",
    "AZP": "C/S 1>4",
    "AZW": "C/C 0>3",
    "AWS": "C/S 0>3",
    "ONP": "C/S 1>3",
    "LEG": "C/S 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Federated accounts follow Entra lifecycle; local SaaS accounts listed through the vendor admin API and compared with sign-in age",
     "notes": "SHARED_DEPENDENT: needs vendor support for last-sign-in data.",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-008",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AC-007",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "enabled inactive account",
      "unknown": "last-sign-in not exposed by the vendor",
      "pass": "no enabled account older than inactivity_period plus disable_sla"
     },
     "evidence": "Vendor user-list API; Entra sign-in activity; provider SOC 2 for vendor-side retention",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Entra: Graph sign-in activity, Lifecycle Workflows disable inactive users and guests; access packages expire",
     "notes": "M3 automation wave; first candidate for AUTO_REMEDIATION_WITH_APPROVAL in Year 2.",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-009",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AC-008",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "any such account",
      "unknown": "sign-in activity unavailable (licence or retention gap)",
      "pass": "zero enabled users or guests with last sign-in older than the threshold"
     },
     "evidence": "Microsoft Graph signInActivity (SRC-GRAPH-001)",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits Entra lifecycle; workload-local identities (service principals, database users) listed and tested separately",
     "notes": "Service principals are the gap most often missed.",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-010",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AC-009",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "stale one found",
      "unknown": "database user list not collected",
      "pass": "no stale service principal credentials or local database users beyond the threshold"
     },
     "evidence": "Entra application credentials; database catalog views",
     "maxAge": "P7D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "IAM credential report and Identity Center last-activity data; Config rule for unused credentials",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-011",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AC-010",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unused credential active",
      "unknown": "credential report not generated",
      "pass": "no IAM user or key unused beyond the threshold"
     },
     "evidence": "IAM credential report; AWS Config rule results",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "AD: lastLogonTimestamp query; scheduled disable script; HR leaver feed",
     "notes": "lastLogonTimestamp replicates with delay; set maximum_age accordingly.",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-012",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AC-011",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "enabled stale account",
      "unknown": "a domain controller not queried",
      "pass": "no enabled AD account with last logon older than the threshold (replication latency allowed)"
     },
     "evidence": "AD attribute export through the on-premises collector",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Legacy ERP user table exported monthly and compared with HR and AD",
     "notes": "No exception needed: native capability exists, only the automation is missing.",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-013",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AC-012",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "orphan or stale active user",
      "unknown": "export not delivered",
      "pass": "no active ERP user absent from HR or inactive beyond the threshold"
     },
     "evidence": "ERP user table export; HR roster",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-AC-003",
   "name": "User access review",
   "statement": "Access rights to in-scope systems are reviewed by their owners at least every {access_review_period} and unapproved rights are removed within {removal_sla}.",
   "behavior": "DETECTIVE",
   "owner": "Head of identity and access management",
   "firstM": "M4",
   "domainGroup": "Identity and access",
   "parameters": "access_review_period = 180 days (90 days for privileged rights, see CTL-AC-001); removal_sla = 14 days.",
   "iso": "A.5.18",
   "nist": "AC-2",
   "nis2": "(i)",
   "annexA": [
    {
     "code": "A.5.18",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 1>3",
    "AZP": "C/S 2>4",
    "AZW": "C/C 0>3",
    "AWS": "C/S 0>3",
    "ONP": "C/S 1>3",
    "LEG": "C/S 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Entra access reviews for SSO-assigned applications; vendor-native role export reviewed by the application owner",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-014",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AC-013",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "review overdue or denied right still present",
      "unknown": "role export unavailable",
      "pass": "review completed and signed within the period and all denied rights removed within removal_sla"
     },
     "evidence": "Access review results (Graph); vendor role export; signed review record",
     "maxAge": "P180D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Entra access reviews for groups, Azure RBAC and applications; results exported through Graph",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-015",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-AC-014",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "overdue instance or undecided right",
      "unknown": "review definitions incomplete",
      "pass": "every in-scope review instance completed within the period with applied decisions"
     },
     "evidence": "Microsoft Graph access review instances and decisions",
     "maxAge": "P7D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits Entra access reviews; application-owner reviews for application roles",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-016",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AC-015",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "no signed review",
      "unknown": "roles not exported",
      "pass": "owner review signed in the period"
     },
     "evidence": "Access review records; application role export",
     "maxAge": "P180D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Identity Center assignment export reviewed by account owners (Entra access reviews on the federated groups)",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-017",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AC-016",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "overdue",
      "unknown": "assignments not exported",
      "pass": "reviewed in the period, removals applied"
     },
     "evidence": "Identity Center assignments API; review record",
     "maxAge": "P180D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "AD group membership attestation by group owners through the ITSM tool",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-018",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AC-017",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "missing attestation",
      "unknown": "group owner not defined",
      "pass": "attestation recorded for every in-scope group in the period"
     },
     "evidence": "ITSM attestation tickets; AD group export",
     "maxAge": "P180D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Quarterly manual ERP role review by the application owner",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-019",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AC-018",
      "method": "INTERVIEW",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "none",
      "unknown": "ERP role list unavailable",
      "pass": "signed review on file within period"
     },
     "evidence": "Signed review; ERP role export",
     "maxAge": "P180D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-AC-004",
   "name": "Joiner, mover and leaver deprovisioning",
   "statement": "Access of a leaver is disabled within {leaver_sla} of the HR termination date and access of a mover is re-approved within {mover_sla}.",
   "behavior": "CORRECTIVE",
   "owner": "Head of identity and access management",
   "firstM": "M4",
   "domainGroup": "Identity and access",
   "parameters": "leaver_sla = 24 hours; mover_sla = 30 days.",
   "iso": "A.5.16; A.5.18; A.6.5",
   "nist": "AC-2; PS-4 (to verify: PS-5)",
   "nis2": "(i)",
   "annexA": [
    {
     "code": "A.5.16",
     "verify": false
    },
    {
     "code": "A.5.18",
     "verify": false
    },
    {
     "code": "A.6.5",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 1>3",
    "AZP": "C/S 1>4",
    "AZW": "C/C 0>3",
    "AWS": "C/S 0>3",
    "ONP": "C/S 0>3",
    "LEG": "C/S 0>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "SCIM provisioning from Entra where supported; vendor-native deactivation otherwise",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-020",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AC-019",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "leaver account enabled",
      "unknown": "HR or vendor user list unavailable",
      "pass": "every HR leaver has no enabled account in the SaaS within leaver_sla"
     },
     "evidence": "HR leaver feed; SCIM logs; vendor user list",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "HR-driven Entra Lifecycle Workflows for joiner, mover, leaver",
     "notes": "HR feed is a new system-of-record dependency.",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-021",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AC-020",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "any later",
      "unknown": "HR feed stale",
      "pass": "all HR leavers disabled in Entra within leaver_sla"
     },
     "evidence": "HR system of record export; Graph audit logs",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits Entra lifecycle; workload-local accounts covered by CTL-AC-002",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-022",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AC-021",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "leaver holds role",
      "unknown": "role export missing",
      "pass": "no leaver holds a workload role"
     },
     "evidence": "Azure Resource Graph role assignments; HR feed",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Federation through Entra removes access with the identity; local IAM users prohibited",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-023",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AC-022",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "leaver present",
      "unknown": "assignments unavailable",
      "pass": "no leaver in Identity Center assignments"
     },
     "evidence": "Identity Center API; HR feed",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "HR-triggered ITSM task to disable AD account; manual completion",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-024",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AC-023",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "task late or AD account enabled",
      "unknown": "sample not obtainable",
      "pass": "ITSM task closed within leaver_sla for the sample"
     },
     "evidence": "ITSM tickets; AD export",
     "maxAge": "P30D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Manual ERP deactivation through the ITSM task",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AC-025",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AC-024",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "late",
      "unknown": "ERP audit trail unavailable",
      "pass": "ERP account disabled within leaver_sla in the sample"
     },
     "evidence": "ITSM tickets; ERP user table",
     "maxAge": "P30D",
     "stageNow": 0,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-IA-002",
   "name": "Secrets management",
   "statement": "Credentials, keys and tokens used by workloads are stored in an approved secret store, rotated at least every {rotation_period} and never present in source code.",
   "behavior": "PROACTIVE",
   "owner": "Head of platform engineering",
   "firstM": "M5",
   "domainGroup": "Identity and access",
   "parameters": "rotation_period = 90 days.",
   "iso": "A.5.17; A.8.24 (to verify)",
   "nist": "IA-5; SC-12 (to verify)",
   "nis2": "to verify",
   "annexA": [
    {
     "code": "A.5.17",
     "verify": false
    },
    {
     "code": "A.8.24",
     "verify": true
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>2",
    "AZP": "C/S 1>4",
    "AZW": "C/C 1>4",
    "AWS": "C/S 0>4",
    "ONP": "C/S 0>3",
    "LEG": "C/S* 0>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "API tokens and integration credentials of SaaS tenants held in the secret store; vendor token expiry enforced where offered",
     "notes": "NOT_OBSERVABLE for vendors without a token list.",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-007",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-IA-007",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "unregistered or expired-not-rotated token",
      "unknown": "vendor does not list tokens",
      "pass": "all integration tokens registered, in the store and within rotation_period"
     },
     "evidence": "Token register; secret-store metadata; vendor token list where available",
     "maxAge": "P30D",
     "stageNow": 0,
     "stageTarget": 2
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Azure Key Vault with RBAC and purge protection; managed identities preferred; Azure Policy audits secret expiry",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-008",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IA-008",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "no expiry or overdue",
      "unknown": "vault not readable",
      "pass": "every secret has an expiry date and age within rotation_period"
     },
     "evidence": "Key Vault metadata via Azure Resource Graph and Policy state",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Workloads use landing-zone Key Vault pattern and managed identities; pipeline secret scanning (proactive)",
     "notes": "Proactive check lives in the pipeline (M5).",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-009",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IA-009",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "secret found",
      "unknown": "repository not scanned",
      "pass": "repository scan finds no secret and no workload credential outside the vault"
     },
     "evidence": "Pipeline scanner results; Key Vault metadata",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "AWS Secrets Manager with rotation; SCP and Config rule deny long-lived access keys",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-010",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-IA-010",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "account unreadable",
      "pass": "no active access key older than rotation_period and secrets rotate automatically"
     },
     "evidence": "Secrets Manager metadata; IAM credential report",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Enterprise password vault for service accounts; group-managed service accounts in AD",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-011",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-IA-011",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "password older than period",
      "unknown": "vault export unavailable",
      "pass": "service accounts in the vault with rotation in period"
     },
     "evidence": "Vault audit export; AD service-account list",
     "maxAge": "P30D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Hard-coded credentials in legacy jobs: rotate manually, restrict to the jump host, monitor use",
     "notes": "Compensating; needs an exception if rotation is impossible.",
     "state": "impl",
     "impl": {
      "id": "IMP-IA-012",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-IA-012",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "unrotated or other source",
      "unknown": "use log missing",
      "pass": "credentials rotated per signed log and only used from the allowed host"
     },
     "evidence": "Rotation log; host logs",
     "maxAge": "P90D",
     "stageNow": 0,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-CM-001",
   "name": "Secure configuration baseline",
   "statement": "In-scope resources conform to the approved configuration baseline {baseline_version} and deviations are detected within {drift_detection_period}.",
   "behavior": "PREVENTIVE",
   "owner": "Head of platform engineering",
   "firstM": "M3",
   "domainGroup": "Asset and configuration",
   "parameters": "baseline_version = current approved version; drift_detection_period = 24 hours.",
   "iso": "A.8.9",
   "nist": "CM-2; CM-6",
   "nis2": "(e) (to verify)",
   "annexA": [
    {
     "code": "A.8.9",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 1>3",
    "AZP": "C/S 2>5",
    "AZW": "C/C 2>4",
    "AWS": "C/S 1>4",
    "ONP": "C/S 1>3",
    "LEG": "C/S* 0>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Tenant security baseline (Microsoft 365 secure score controls, vendor security settings) checked against the baseline",
     "notes": "Settings with no API are NOT_OBSERVABLE.",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-001",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-001",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "a setting differs",
      "unknown": "setting not exposed by API",
      "pass": "all baseline settings equal the approved values"
     },
     "evidence": "Graph security and tenant configuration APIs; vendor settings export",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Azure landing-zone policy initiative (audit and deny effects), Defender for Cloud benchmark; policy assigned at management-group scope from Git",
     "notes": "Classify each policy by effect: deny is PREVENTIVE, audit is DETECTIVE. Common control inherited by workloads.",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-CM-002",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL3",
      "fail": "any non-compliant resource (an EXCEPTION_ACTIVE overlay does not change the result)",
      "unknown": "policy state older than maximum_age",
      "pass": "policy compliance is 100% for in-scope resources"
     },
     "evidence": "Azure Policy compliance state; Defender for Cloud (CONN-AZPOLICY-001, illustrative)",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 5
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits landing-zone policy; workload IaC modules pre-validated in the pipeline (proactive)",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-003",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-CM-003",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "non-compliance",
      "unknown": "subscription outside policy scope or state missing",
      "pass": "inheritance valid and workload policy compliance 100%"
     },
     "evidence": "Azure Policy state; IaC scan results",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Control Tower guardrails, AWS Config conformance packs, Security Hub standards; baselines in Terraform",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-004",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "non-compliant rule",
      "unknown": "account not enrolled",
      "pass": "conformance packs compliant in all accounts"
     },
     "evidence": "AWS Config and Security Hub via API",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "CIS-style baselines applied with Group Policy and configuration management; compliance scan weekly",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-005",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "deviating host",
      "unknown": "host not scanned in maximum_age",
      "pass": "scan shows baseline compliance for every in-scope host"
     },
     "evidence": "Configuration-management compliance report; Group Policy results",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Hardening by documented checklist; unsupported OS or application settings compensated by isolation and monitoring",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-006",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "deviation without compensation",
      "unknown": "no checklist",
      "pass": "checklist signed for each host in the period"
     },
     "evidence": "Signed checklist; vulnerability scan config audit",
     "maxAge": "P90D",
     "stageNow": 0,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-CM-002",
   "name": "System and asset inventory",
   "statement": "Every in-scope system and asset is recorded in the system of record with an owner, and inventory sources reconcile within {reconciliation_tolerance}.",
   "behavior": "DETECTIVE",
   "owner": "Head of IT operations",
   "firstM": "M1",
   "domainGroup": "Asset and configuration",
   "parameters": "reconciliation_tolerance = 2% unmatched assets.",
   "iso": "A.5.9",
   "nist": "CM-8",
   "nis2": "(i)",
   "annexA": [
    {
     "code": "A.5.9",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "C/S 1>3",
    "AZP": "C/S 2>4",
    "AZW": "C/C 2>4",
    "AWS": "C/S 1>4",
    "ONP": "C/S 1>3",
    "LEG": "C/S 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "SaaS tenants registered as systems; discovery from Entra enterprise applications, expense and procurement data and the CASB",
     "notes": "Shadow SaaS is the main coverage-denominator risk.",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-007",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-007",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unregistered or ownerless application",
      "unknown": "discovery source stale",
      "pass": "every discovered SaaS application has a system record and an owner"
     },
     "evidence": "Entra enterprise applications; CASB export; system register",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Azure Resource Graph reconciled with the CMDB; subscriptions required by policy to carry owner and system tags",
     "notes": "R2: reconciliation report supplies coverage denominators (gate input for M3 and M4).",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-008",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-CM-008",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "over tolerance or ownerless resource",
      "unknown": "Resource Graph or CMDB read incomplete",
      "pass": "every resource has an owner tag and a CMDB record, unmatched under tolerance"
     },
     "evidence": "Azure Resource Graph; CMDB export (SRC-CMDB-001, illustrative)",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Tag policy and subscription vending register each workload with a system record",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-009",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-CM-009",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "unmapped subscription",
      "unknown": "vending register stale",
      "pass": "every workload subscription maps to a SYS- record and owner"
     },
     "evidence": "Azure Resource Graph; subscription register",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "AWS Config aggregator and Organizations account list reconciled with the CMDB",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-010",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-010",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unmatched over tolerance",
      "unknown": "aggregator missing an account",
      "pass": "every account and resource type in scope has a CMDB record"
     },
     "evidence": "AWS Config aggregator; Organizations API",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "CMDB plus network discovery and EDR agent list reconciled",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-011",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-011",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "over tolerance",
      "unknown": "discovery scan older than maximum_age",
      "pass": "hosts seen by discovery or EDR exist in the CMDB within tolerance"
     },
     "evidence": "CMDB; EDR device list; network scan",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Legacy systems listed in the CMDB by manual review including undocumented interfaces",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-012",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-012",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "unlisted device seen",
      "unknown": "scan unavailable",
      "pass": "legacy register signed in the period and matches network scan"
     },
     "evidence": "Signed register; network scan",
     "maxAge": "P90D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-CM-003",
   "name": "Change management",
   "statement": "Every production change is recorded, approved according to its risk class and linked to the deployed artifact before deployment.",
   "behavior": "PROACTIVE",
   "owner": "Head of IT service management",
   "firstM": "M4",
   "domainGroup": "Asset and configuration",
   "parameters": "Risk classes and approvers set in the change policy.",
   "iso": "A.8.32",
   "nist": "CM-3",
   "nis2": "(e)",
   "annexA": [
    {
     "code": "A.8.32",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>3",
    "AZP": "C/S 1>4",
    "AZW": "C/S 1>4",
    "AWS": "C/S 0>4",
    "ONP": "C/S 1>3",
    "LEG": "C/S 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Tenant configuration changes follow ITSM change records; audit-log changes compared with change tickets",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-013",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CM-013",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "untracked change",
      "unknown": "audit log not obtainable",
      "pass": "every configuration change in the audit log sample has an approved ticket"
     },
     "evidence": "Unified audit log; ITSM change records",
     "maxAge": "P30D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Landing-zone changes only through Git pull request with required reviewers and pipeline; ITSM ticket reference mandatory",
     "notes": "E §41: no manual production changes.",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-014",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-014",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "portal or unapproved change",
      "unknown": "pipeline log missing",
      "pass": "every deployment links a merged pull request with required approvals and a ticket"
     },
     "evidence": "Git platform and pipeline logs; Azure Activity Log; ITSM",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Workload pipelines with environment approvals and policy gates",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-015",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-015",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "out-of-pipeline deployment",
      "unknown": "pipeline history incomplete",
      "pass": "all production deployments came from the approved pipeline with approval"
     },
     "evidence": "Pipeline run history; Activity Log",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Same pipeline pattern; CloudTrail detects out-of-pipeline changes",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-016",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CM-016",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "such a call",
      "unknown": "CloudTrail gap",
      "pass": "no write API call outside the deployment role"
     },
     "evidence": "CloudTrail; pipeline history",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "ITSM change advisory process; configuration-management tool as the deployment channel",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-017",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-017",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "untracked change",
      "unknown": "history unavailable",
      "pass": "sampled changes have approved tickets and match config-management history"
     },
     "evidence": "ITSM; configuration-management history",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Manual change requests approved by the application owner",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-018",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-018",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "missing approval",
      "unknown": "no change log",
      "pass": "sampled changes have approved tickets"
     },
     "evidence": "ITSM; ERP transport log",
     "maxAge": "P90D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-CM-004",
   "name": "Approved software and images",
   "statement": "Only software and machine images from the approved catalog {approved_catalog} run on in-scope systems.",
   "behavior": "PREVENTIVE",
   "owner": "Head of platform engineering",
   "firstM": "M5",
   "domainGroup": "Asset and configuration",
   "parameters": "approved_catalog = approved software and image register.",
   "iso": "A.8.19",
   "nist": "CM-7; CM-11 (to verify)",
   "nis2": "to verify",
   "annexA": [
    {
     "code": "A.8.19",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>3",
    "AZP": "C/S 0>4",
    "AZW": "C/C 0>4",
    "AWS": "C/S 0>4",
    "ONP": "C/S 1>3",
    "LEG": "C/S* 0>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "OAuth application consent restricted to admin-approved applications",
     "notes": "Applies to third-party apps connected to the tenant.",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-019",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CM-019",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unapproved consent",
      "unknown": "consent list unavailable",
      "pass": "user consent disabled and every consented application is in the catalog"
     },
     "evidence": "Graph consent grants",
     "maxAge": "P7D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Azure Policy allowed image and extension lists; Defender for Cloud adaptive controls",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-020",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CM-020",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unapproved image",
      "unknown": "image metadata missing",
      "pass": "all VMs from approved images"
     },
     "evidence": "Azure Policy state; Resource Graph",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits image policy; container registry allow-list in the pipeline (proactive)",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-021",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CM-021",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "other image",
      "unknown": "admission data missing",
      "pass": "only signed images from the approved registry deployed"
     },
     "evidence": "Registry and admission-controller logs",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Approved AMI list through Config rule and SCP",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-022",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CM-022",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "account unreadable",
      "pass": "all instances from approved AMIs"
     },
     "evidence": "AWS Config",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Application allow-listing on servers and endpoints; software deployment through one tool",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-023",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CM-023",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "found",
      "unknown": "inventory stale",
      "pass": "no unapproved executable in the sample"
     },
     "evidence": "Software inventory; EDR",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Frozen configuration; change only through change management; integrity monitoring",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CM-024",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CM-024",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "unapproved change",
      "unknown": "report missing",
      "pass": "file-integrity report shows no unapproved change"
     },
     "evidence": "Integrity monitoring report",
     "maxAge": "P30D",
     "stageNow": 0,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-VR-001",
   "name": "Vulnerability remediation",
   "statement": "In-scope assets are scanned at least every {scan_interval} and vulnerabilities rated critical or high are remediated within {remediation_sla}.",
   "behavior": "DETECTIVE",
   "owner": "Head of security operations",
   "firstM": "M3",
   "domainGroup": "Vulnerability and testing",
   "parameters": "scan_interval = 7 days; remediation_sla = 14 days (critical), 30 days (high); maximum age of vulnerability evidence: see D10.",
   "iso": "A.8.8",
   "nist": "RA-5; SI-2",
   "nis2": "(e)",
   "annexA": [
    {
     "code": "A.8.8",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "P/S 1>2",
    "AZP": "C/S 1>4",
    "AZW": "C/S 1>4",
    "AWS": "C/S 0>4",
    "ONP": "C/S 2>4",
    "LEG": "C/S* 1>3"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Vendor patches and operates the platform; customer tracks vendor security advisories and customer-managed integrations",
     "notes": "Provider-controlled: ingested provider evidence is LOW confidence alone. NOT_OBSERVABLE.",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-001",
      "party": "PROVIDER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-VR-001",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "such an advisory open",
      "unknown": "report expired",
      "pass": "current vendor assurance report on file and no open critical advisory affecting customer-managed components past SLA"
     },
     "evidence": "Provider SOC 2 Type 2 and penetration-test summary; advisory feed",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 2
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Defender for Cloud vulnerability assessment and agentless scanning; platform images rebuilt monthly",
     "notes": "Coverage denominator from CTL-CM-002.",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-VR-002",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "any such",
      "unknown": "asset not scanned within scan_interval",
      "pass": "no critical or high finding older than remediation_sla"
     },
     "evidence": "Defender for Cloud assessments (CONN-DEFENDER-001, illustrative); scanner API",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Same scanning; container image scanning in the pipeline (proactive)",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-003",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-VR-003",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "any breach",
      "unknown": "scan gap",
      "pass": "as above plus no critical image vulnerability deployed"
     },
     "evidence": "Defender for Cloud; pipeline scan results",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Amazon Inspector and Security Hub findings",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-VR-004",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "Inspector not enabled for an account",
      "pass": "no critical or high finding beyond SLA"
     },
     "evidence": "Inspector and Security Hub via API",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Enterprise vulnerability scanner with authenticated scans; patching through configuration management",
     "notes": "Scanner is the system of record for vulnerability data.",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-VR-005",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "breach",
      "unknown": "host not scanned in scan_interval",
      "pass": "as above"
     },
     "evidence": "Scanner export (SRC-VM-001, illustrative)",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Unpatchable systems: scanned where safe, isolated, virtual patching by IPS, risk accepted by owner",
     "notes": "Legacy coverage is reported from the organization's own data.",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-VR-006",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "open critical without plan",
      "unknown": "scan not possible and no plan",
      "pass": "compensating controls verified in the period and each open vulnerability has an approved plan"
     },
     "evidence": "Scanner export; IPS rules; exception register",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 3
    }
   }
  },
  {
   "id": "CTL-VR-002",
   "name": "Security testing",
   "statement": "Each in-scope application and the external attack surface undergo a security test at least every {security_test_interval} and critical findings are tracked to closure.",
   "behavior": "DETECTIVE",
   "owner": "Head of security operations",
   "firstM": "M5",
   "domainGroup": "Vulnerability and testing",
   "parameters": "security_test_interval = 12 months.",
   "iso": "A.8.29",
   "nist": "CA-8; CA-2 (to verify)",
   "nis2": "(f)",
   "annexA": [
    {
     "code": "A.8.29",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>2",
    "AZP": "C/S 0>3",
    "AZW": "C/S 0>4",
    "AWS": "C/S 0>3",
    "ONP": "C/S 1>3",
    "LEG": "C/S 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Customer-run configuration review; vendor penetration-test summary requested",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-007",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-VR-007",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "critical open",
      "unknown": "summary missing",
      "pass": "vendor summary under 12 months and no open critical"
     },
     "evidence": "Vendor penetration-test summary; internal review",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 2
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Annual external test of landing-zone controls; continuous attack-surface scanning",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-008",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-VR-008",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "report missing",
      "pass": "report within interval and critical findings closed in SLA"
     },
     "evidence": "Test report; findings in ITSM",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Pipeline DAST and SAST plus annual penetration test per risk class",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-009",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-VR-009",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "critical open",
      "unknown": "scan gap",
      "pass": "scans pass thresholds and test report in interval"
     },
     "evidence": "Pipeline results; test report",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "As Azure workload",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-010",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-VR-010",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "critical open",
      "unknown": "report missing",
      "pass": "report in interval and critical closed in SLA"
     },
     "evidence": "Pipeline results; test report",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Annual internal penetration test and authenticated scanning",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-011",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-VR-011",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "missing",
      "pass": "report in interval and critical closed in SLA"
     },
     "evidence": "Test report",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Annual test with care for fragile systems; results drive compensating controls",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-VR-012",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-VR-012",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "critical open without plan",
      "unknown": "missing",
      "pass": "report in interval"
     },
     "evidence": "Test report",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-AU-001",
   "name": "Centralized security logging",
   "statement": "Security-relevant events of every in-scope system are sent to the central log platform within {log_latency} and retained for {log_retention} with integrity protection.",
   "behavior": "DETECTIVE",
   "owner": "Head of security operations",
   "firstM": "M3",
   "domainGroup": "Logging and detection",
   "parameters": "log_latency = 15 minutes; log_retention = 12 months online.",
   "iso": "A.8.15",
   "nist": "AU-2; AU-12; AU-11 (to verify: AU-9)",
   "nis2": "to verify",
   "annexA": [
    {
     "code": "A.8.15",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 2>4",
    "AZP": "C/S 2>5",
    "AZW": "C/C 2>4",
    "AWS": "C/S 1>4",
    "ONP": "C/S 1>4",
    "LEG": "C/S* 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Microsoft 365 Unified Audit Log via API into the SIEM; vendor audit logs pulled where an API exists",
     "notes": "0.2 §32 SaaS path. Vendors without audit API: NOT_OBSERVABLE.",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-001",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-AU-001",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "no events or retention below log_retention",
      "unknown": "API connector failed",
      "pass": "audit events from each in-scope tenant arrived within log_latency in the last 24 hours and retention is configured"
     },
     "evidence": "Management Activity API; SIEM ingestion metrics (SRC-SIEM-001, illustrative)",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Policy-enforced diagnostic settings to central Log Analytics and Sentinel; deny effect on missing settings (PREVENTIVE) plus audit",
     "notes": "Common control inherited by workloads (B §22).",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-AU-002",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL3",
      "fail": "missing setting or silent source",
      "unknown": "workspace query fails",
      "pass": "every in-scope resource has diagnostic settings to the central workspace and events arrive within log_latency"
     },
     "evidence": "Azure Policy state; Log Analytics heartbeat queries",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 5
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits central logging; workload application logs added through the logging module",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-003",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-AU-003",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "silent workload",
      "unknown": "workspace query fails",
      "pass": "inheritance valid and application logs present"
     },
     "evidence": "Log Analytics queries; policy state",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Organization CloudTrail and Config aggregated to a log-archive account and forwarded to the SIEM",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AU-004",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "a trail or account missing",
      "unknown": "archive account unreadable",
      "pass": "organization trail enabled in all regions and delivery within log_latency"
     },
     "evidence": "CloudTrail status API; SIEM metrics",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Windows Event Forwarding and syslog to the SIEM",
     "notes": "0.2 §32 on-premises path.",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AU-005",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "silent host",
      "unknown": "inventory unavailable",
      "pass": "every inventoried host sent events in the last 24 hours"
     },
     "evidence": "SIEM source list reconciled with CMDB",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Partial application logging plus network monitoring plus manual review of ERP logs",
     "notes": "Compensating control with residual risk (0.2 §32).",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AU-006",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "gap in review",
      "unknown": "logs not supplied",
      "pass": "network monitor and application log reviews are signed for the period"
     },
     "evidence": "Network monitor events; signed log review",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-AU-002",
   "name": "Security monitoring and alerting",
   "statement": "Security alerts on in-scope systems are triaged within {triage_sla} and detection coverage of the approved use cases is verified at least every {detection_test_interval}.",
   "behavior": "DETECTIVE",
   "owner": "Head of security operations",
   "firstM": "M4",
   "domainGroup": "Logging and detection",
   "parameters": "triage_sla = 4 hours (high severity); detection_test_interval = 90 days.",
   "iso": "A.8.16",
   "nist": "SI-4; IR-5 (to verify)",
   "nis2": "(b) (to verify)",
   "annexA": [
    {
     "code": "A.8.16",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>3",
    "AZP": "C/S 1>4",
    "AZW": "C/C 1>3",
    "AWS": "C/S 0>3",
    "ONP": "C/S 1>4",
    "LEG": "C/S* 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Alert rules on SaaS audit events in the SIEM; vendor-native alerts forwarded",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-007",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AU-007",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "no alert",
      "unknown": "connector down",
      "pass": "use-case alerts exist and a test event raised an alert in the period"
     },
     "evidence": "SIEM rule list; test-event record",
     "maxAge": "P90D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Microsoft Sentinel analytics rules and Defender XDR; MITRE ATT&CK coverage map",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-008",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AU-008",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "rule disabled or SLA missed",
      "unknown": "incident data missing",
      "pass": "rules enabled for the approved use cases and triage times within SLA"
     },
     "evidence": "Sentinel rule and incident APIs",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits Sentinel; workload-specific detections added through code",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-009",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AU-009",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "not covered",
      "unknown": "unknown rule state",
      "pass": "workload use cases covered"
     },
     "evidence": "Sentinel rules from Git",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "GuardDuty and Security Hub findings forwarded to the SIEM",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-010",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-AU-010",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "disabled",
      "unknown": "account unreadable",
      "pass": "GuardDuty enabled in all accounts and findings forwarded"
     },
     "evidence": "GuardDuty status; SIEM",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "SIEM correlation rules plus EDR alerts; 24x7 monitoring by the SOC",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-011",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AU-011",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "breach",
      "unknown": "ticket data missing",
      "pass": "triage times within SLA in the sample and rules tested in period"
     },
     "evidence": "SIEM and ITSM incident data",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Network detection sensors at the legacy segment boundary",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-AU-012",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-AU-012",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "sensor silent",
      "unknown": "no sensor data",
      "pass": "sensors active and alerts reviewed in the period"
     },
     "evidence": "Sensor health; review record",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-SI-001",
   "name": "Endpoint protection",
   "statement": "Every in-scope endpoint and server runs the approved endpoint protection agent with signatures or detections updated within {agent_update_age}.",
   "behavior": "PREVENTIVE",
   "owner": "Head of security operations",
   "firstM": "M4",
   "domainGroup": "Protection",
   "parameters": "agent_update_age = 3 days.",
   "iso": "A.8.7; A.8.1",
   "nist": "SI-3; SI-4 (to verify)",
   "nis2": "(g) (to verify)",
   "annexA": [
    {
     "code": "A.8.7",
     "verify": false
    },
    {
     "code": "A.8.1",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "P/S 1>3",
    "AZP": "C/S 1>4",
    "AZW": "C/C 1>4",
    "AWS": "C/S 0>3",
    "ONP": "C/S 2>4",
    "LEG": "C/S* 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Not applicable to the vendor platform; managed devices that access the tenant must be compliant (device compliance in Conditional Access)",
     "notes": "Cell covers the customer access path; platform malware protection is provider-controlled (NOT_OBSERVABLE).",
     "state": "impl",
     "impl": {
      "id": "IMP-SI-001",
      "party": "PROVIDER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-SI-001",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unmanaged device allowed",
      "unknown": "policy list incomplete",
      "pass": "Conditional Access requires a compliant device for administrator access"
     },
     "evidence": "Graph Conditional Access and device compliance; provider SOC 2 for the platform",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Defender for Servers and Defender for Endpoint on platform VMs; onboarding enforced by policy",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SI-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SI-002",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "missing or stale agent",
      "unknown": "device list incomplete",
      "pass": "every VM has the agent healthy and updated within agent_update_age"
     },
     "evidence": "Defender for Endpoint device API; Azure Resource Graph",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits Defender plan; containers and PaaS protected by workload plans",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SI-003",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SI-003",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "not",
      "unknown": "list missing",
      "pass": "inheritance valid and agent healthy"
     },
     "evidence": "Defender APIs",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "EDR agent in instance baseline images; Systems Manager reports agent status",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SI-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-SI-004",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "SSM inventory incomplete",
      "pass": "every instance reports healthy agent"
     },
     "evidence": "EDR console API; Systems Manager inventory",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "EDR on servers and workstations; managed by the endpoint team",
     "notes": "Coverage metric depends on CTL-CM-002.",
     "state": "impl",
     "impl": {
      "id": "IMP-SI-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-SI-005",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "gap",
      "unknown": "CMDB or EDR list stale",
      "pass": "100% of CMDB hosts have healthy updated agent"
     },
     "evidence": "EDR console API reconciled with CMDB",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Where agents cannot run: application allow-listing, network isolation, IPS",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SI-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SI-006",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "deviation",
      "unknown": "report missing",
      "pass": "allow-listing report clean and isolation verified in the period"
     },
     "evidence": "Allow-listing report; firewall export",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-SC-001",
   "name": "Data encryption",
   "statement": "Data classified {encryption_scope} is encrypted at rest with approved algorithms and in transit with TLS version {min_tls} or higher.",
   "behavior": "PREVENTIVE",
   "owner": "Head of platform engineering",
   "firstM": "M3",
   "domainGroup": "Protection",
   "parameters": "encryption_scope = confidential and above; min_tls = 1.2.",
   "iso": "A.8.24",
   "nist": "SC-28; SC-8",
   "nis2": "(h)",
   "annexA": [
    {
     "code": "A.8.24",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 1>3",
    "AZP": "C/S 2>5",
    "AZW": "C/C 2>4",
    "AWS": "C/S 1>4",
    "ONP": "C/S 1>3",
    "LEG": "C/S* 0>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Provider encrypts data at rest and in transit; customer configures tenant options (customer-managed keys where offered, TLS policy for integrations)",
     "notes": "Provider share NOT_OBSERVABLE directly.",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-001",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-001",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "option disabled",
      "unknown": "option not exposed",
      "pass": "provider report states encryption and customer options are set to required values"
     },
     "evidence": "Provider SOC 2 and ISO/IEC 27001 certificate; tenant settings API; P365D (provider)",
     "maxAge": "P7D (settings)",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Azure Policy deny for unencrypted storage and TLS below minimum; platform key management in Key Vault",
     "notes": "E §59 first automated control.",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-SC-002",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL3",
      "fail": "any resource not",
      "unknown": "resource type not evaluated",
      "pass": "all in-scope storage and databases encrypted and TLS >= min_tls"
     },
     "evidence": "Azure Policy state; Resource Graph",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 5
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits policies; workload chooses customer-managed keys where classification requires",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-003",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-SC-003",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "classification missing",
      "pass": "as above plus customer-managed key where required"
     },
     "evidence": "Azure Policy; data-classification tags",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "SCP and Config rules enforce encryption of S3, EBS, RDS; KMS key policies",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-004",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "account unreadable",
      "pass": "no unencrypted in-scope resource"
     },
     "evidence": "AWS Config rules",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Disk encryption on servers and endpoints; TLS configuration scanning; database TDE",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-005",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "host not scanned",
      "pass": "scan shows encryption and TLS minimum for in-scope hosts"
     },
     "evidence": "Scanner TLS report; endpoint management",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Legacy cannot use TLS 1.2: terminate TLS at a proxy and isolate the segment",
     "notes": "Candidate for an exception if the proxy is not feasible.",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-006",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "direct plaintext path",
      "unknown": "proxy config unavailable",
      "pass": "proxy terminates TLS >= min_tls for all client paths"
     },
     "evidence": "Proxy configuration; network scan",
     "maxAge": "P90D",
     "stageNow": 0,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-SC-002",
   "name": "Network segmentation",
   "statement": "In-scope networks are segmented by zone and traffic between zones is permitted only by rules recorded in the approved rule base.",
   "behavior": "PREVENTIVE",
   "owner": "Head of network engineering",
   "firstM": "M4",
   "domainGroup": "Protection",
   "parameters": "Zone model and rule base per the network security standard.",
   "iso": "A.8.22",
   "nist": "SC-7",
   "nis2": "to verify",
   "annexA": [
    {
     "code": "A.8.22",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "P/S 1>2",
    "AZP": "C/S 1>5",
    "AZW": "C/C 1>4",
    "AWS": "C/S 0>4",
    "ONP": "C/S 1>3",
    "LEG": "C/S* 1>3"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Vendor-controlled multi-tenant segregation; customer restricts access with IP allow-lists or Conditional Access named locations",
     "notes": "PROVIDER for isolation; NOT_OBSERVABLE.",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-007",
      "party": "PROVIDER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-SC-007",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "report expired or no restriction",
      "unknown": "setting not exposed",
      "pass": "provider report on tenant segregation current and customer allow-list configured"
     },
     "evidence": "Provider SOC 2 and ISO certificate; tenant location policy",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 2
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Hub-and-spoke with Azure Firewall, NSG baselines and policy deny on any-any rules",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-008",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-008",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL3",
      "fail": "unapproved rule",
      "unknown": "effective rules not readable",
      "pass": "no NSG or firewall rule outside the approved rule base"
     },
     "evidence": "Azure Resource Graph; Firewall Manager; rule base in Git",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 5
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Spoke network inherits firewall path; workload NSGs from IaC",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-009",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-009",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "bypass",
      "unknown": "effective routes unreadable",
      "pass": "workload NSGs conform and traffic routes via hub"
     },
     "evidence": "Resource Graph; flow logs",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Transit gateway, security groups and SCPs; Config rule on open ingress",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-010",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-SC-010",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "account unreadable",
      "pass": "no unapproved ingress"
     },
     "evidence": "AWS Config; VPC flow logs",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Firewalls and VLANs per zone; rule-base review",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-011",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-011",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "drift or overdue review",
      "unknown": "export older than maximum_age",
      "pass": "firewall configuration equals approved rule base and review signed"
     },
     "evidence": "Firewall configuration export; rule-review record",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Legacy segment isolated behind a dedicated firewall; only named flows allowed",
     "notes": "Underpins the compensating controls of CTL-AC-001 and CTL-IA-001.",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-012",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-012",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "other flow",
      "unknown": "export missing",
      "pass": "firewall rules for the segment equal the approved flows"
     },
     "evidence": "Firewall export; flow records",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 3
    }
   }
  },
  {
   "id": "CTL-SC-003",
   "name": "Public exposure restriction",
   "statement": "No in-scope storage, database or management interface is reachable from the internet unless it is recorded in the approved exposure register.",
   "behavior": "PREVENTIVE",
   "owner": "Head of platform engineering",
   "firstM": "M3",
   "domainGroup": "Protection",
   "parameters": "Exposure register in the control repository.",
   "iso": "A.8.20; A.8.3",
   "nist": "SC-7; CM-7 (to verify)",
   "nis2": "to verify",
   "annexA": [
    {
     "code": "A.8.20",
     "verify": false
    },
    {
     "code": "A.8.3",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>3",
    "AZP": "C/S 2>5",
    "AZW": "C/C 2>4",
    "AWS": "C/S 1>4",
    "ONP": "C/S 1>3",
    "LEG": "C/S 1>3"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Tenant sharing settings: anonymous links and external sharing restricted",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-013",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-SC-013",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "setting not exposed",
      "pass": "anonymous sharing disabled or limited to registered sites"
     },
     "evidence": "Tenant sharing configuration via API",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Azure Policy deny on public IPs for platform subnets and on public blob access; external attack-surface scan",
     "notes": "E §59 first automated control (public cloud storage, exposed services).",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-014",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-SC-014",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL3",
      "fail": "any",
      "unknown": "scan failed",
      "pass": "no public endpoint outside the register"
     },
     "evidence": "Azure Policy; external scan; Resource Graph",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 5
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits deny policies; exposure exceptions registered per workload",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-015",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-SC-015",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "unregistered endpoint",
      "unknown": "scan failed",
      "pass": "all public endpoints in register"
     },
     "evidence": "Policy; scan",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "S3 Block Public Access by SCP, Config rules, external scan",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-016",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-016",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "any",
      "unknown": "account unreadable",
      "pass": "no public bucket or open security group outside the register"
     },
     "evidence": "AWS Config; external scan",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Perimeter firewall rule base; external scan of address ranges",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-017",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-017",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unregistered service",
      "unknown": "scan older than maximum_age",
      "pass": "external scan shows only registered services"
     },
     "evidence": "External scan; firewall export",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "No direct internet exposure; reachable through the jump server only",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-018",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-018",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "found",
      "unknown": "scan missing",
      "pass": "external scan finds no legacy address"
     },
     "evidence": "External scan",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 3
    }
   }
  },
  {
   "id": "CTL-SC-004",
   "name": "Cryptographic key management",
   "statement": "Cryptographic keys for in-scope data are generated, stored and rotated in an approved key store according to {key_rotation_period}.",
   "behavior": "PREVENTIVE",
   "owner": "Head of platform engineering",
   "firstM": "M5",
   "domainGroup": "Protection",
   "parameters": "key_rotation_period = 365 days.",
   "iso": "A.8.24",
   "nist": "SC-12",
   "nis2": "(h)",
   "annexA": [
    {
     "code": "A.8.24",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>2",
    "AZP": "C/S 1>4",
    "AZW": "C/C 0>4",
    "AWS": "C/S 0>4",
    "ONP": "C/S 1>3",
    "LEG": "C/S* 0>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Customer-managed key option used where offered; key lifecycle by vendor otherwise",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-019",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-SC-019",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "required option unused",
      "unknown": "vendor does not expose",
      "pass": "customer-managed key in use where classification requires and vendor key policy on file"
     },
     "evidence": "Tenant key settings; provider documentation",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 2
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Key Vault Premium or managed HSM, rotation policies, purge protection by policy",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-020",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-020",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "vault unreadable",
      "pass": "every key has rotation policy within key_rotation_period"
     },
     "evidence": "Key Vault key metadata",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Workload keys in the landing-zone vault pattern",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-021",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-SC-021",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "vault unreadable",
      "pass": "same as platform"
     },
     "evidence": "Key Vault metadata",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "AWS KMS with automatic rotation and key policy checks",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-022",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-SC-022",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "unreadable",
      "pass": "customer keys rotate within period"
     },
     "evidence": "KMS API; Config",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Internal CA and HSM; manual key ceremonies",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-023",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SC-023",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "overdue",
      "unknown": "log missing",
      "pass": "ceremony log and rotation record in period"
     },
     "evidence": "Ceremony log; CA database",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Legacy key files held offline with dual control",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SC-024",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-SC-024",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "otherwise",
      "unknown": "no log",
      "pass": "access log shows dual control and rotation record"
     },
     "evidence": "Access log",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-CP-001",
   "name": "Backup",
   "statement": "Backups of in-scope data complete successfully at least every {backup_interval}, are stored in an isolated location and are retained for {backup_retention}.",
   "behavior": "CORRECTIVE",
   "owner": "Head of IT operations",
   "firstM": "M3",
   "domainGroup": "Resilience",
   "parameters": "backup_interval = 24 hours; backup_retention = 35 days.",
   "iso": "A.8.13",
   "nist": "CP-9",
   "nis2": "(c)",
   "annexA": [
    {
     "code": "A.8.13",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>3",
    "AZP": "C/S 2>5",
    "AZW": "C/C 1>4",
    "AWS": "C/S 0>4",
    "ONP": "C/S 2>4",
    "LEG": "C/S 1>3"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Vendor resilience plus customer-side backup of tenant data (third-party or export) where the contract does not guarantee recovery",
     "notes": "The vendor is PROVIDER for platform availability only; data recovery by the customer is often assumed and not true.",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-001",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CP-001",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "failed job or no commitment",
      "unknown": "job status unavailable",
      "pass": "provider recovery commitment on file and customer backup job succeeded within backup_interval"
     },
     "evidence": "Backup tool API; provider SOC 2 availability criteria; P1D (job)",
     "maxAge": "P365D (provider)",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Azure Backup policies enforced by Azure Policy for platform VMs and databases; immutable vault",
     "notes": "E §59 first automated control.",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-CP-002",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL3",
      "fail": "failed or missing",
      "unknown": "vault not readable",
      "pass": "every in-scope resource has a successful backup within backup_interval in an immutable vault"
     },
     "evidence": "Azure Backup reports (Resource Graph, Recovery Services API)",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 5
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits backup policy; workload databases and storage tagged for backup tiers",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-003",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CP-003",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "untagged or failed",
      "unknown": "tag missing",
      "pass": "as platform"
     },
     "evidence": "Azure Backup reports",
     "maxAge": "P1D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "AWS Backup plans via organization policy; vault lock",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CP-004",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "unreadable",
      "pass": "every tagged resource backed up within interval"
     },
     "evidence": "AWS Backup API",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Enterprise backup platform with immutable copy",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-CP-005",
      "method": "TEST",
      "aalNow": "AAL1",
      "aalDesigned": "AAL2",
      "fail": "failed or missing job",
      "unknown": "backup catalog unavailable",
      "pass": "last job succeeded for every CMDB host in scope"
     },
     "evidence": "Backup platform API reconciled with CMDB",
     "maxAge": "P1D",
     "stageNow": 2,
     "stageTarget": 4
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Tape or snapshot backup with manual job check",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CP-006",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "failed job without rerun",
      "unknown": "log missing",
      "pass": "job log reviewed daily and signed weekly"
     },
     "evidence": "Job logs; signed review",
     "maxAge": "P7D",
     "stageNow": 1,
     "stageTarget": 3
    }
   }
  },
  {
   "id": "CTL-CP-002",
   "name": "Recovery testing",
   "statement": "Restoration of in-scope systems from backup is tested at least every {restore_test_interval} and meets the recovery time objective.",
   "behavior": "DETECTIVE",
   "owner": "Head of IT operations",
   "firstM": "M8",
   "domainGroup": "Resilience",
   "parameters": "restore_test_interval = 12 months (critical systems); RTO per business service.",
   "iso": "A.5.30; A.8.13",
   "nist": "CP-4; CP-10",
   "nis2": "(c)",
   "annexA": [
    {
     "code": "A.5.30",
     "verify": false
    },
    {
     "code": "A.8.13",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>2",
    "AZP": "C/S 0>4",
    "AZW": "C/S 0>3",
    "AWS": "C/S 0>3",
    "ONP": "C/S 1>3",
    "LEG": "C/S 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Vendor DR evidence plus customer restore test of exported data",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-007",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CP-007",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "otherwise",
      "unknown": "no record",
      "pass": "restore test record in interval within RTO and vendor DR report current"
     },
     "evidence": "Test record; provider SOC 2 availability and DR statements",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 2
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Scripted restore test into an isolated subscription with checksum comparison",
     "notes": "M8 gate: restore and DR test with evidence-hash verification.",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-008",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CP-008",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "failed or over RTO",
      "unknown": "test not run in interval",
      "pass": "restore completed within RTO and hash matches"
     },
     "evidence": "Restore job logs; hash comparison",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Workload runbook restore test",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-009",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CP-009",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "none",
      "pass": "signed test report within RTO"
     },
     "evidence": "Test report",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Scripted restore test",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-010",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-CP-010",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "none",
      "pass": "restore within RTO with hash match"
     },
     "evidence": "Restore logs",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Annual DR exercise for critical systems",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-011",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CP-011",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "missed RTO",
      "unknown": "none",
      "pass": "signed exercise report within RTO"
     },
     "evidence": "Exercise report",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Annual restore test onto spare hardware",
     "notes": "Hardware for restore may no longer exist; a finding in itself.",
     "state": "impl",
     "impl": {
      "id": "IMP-CP-012",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-CP-012",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "failed restore",
      "unknown": "none",
      "pass": "signed report"
     },
     "evidence": "Test report",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-IR-001",
   "name": "Incident response handling",
   "statement": "Security incidents are classified, handled and closed under the approved incident process, and the process is exercised at least every {ir_exercise_interval}.",
   "behavior": "CORRECTIVE",
   "owner": "Head of security operations",
   "firstM": "M4",
   "domainGroup": "Incident management",
   "parameters": "ir_exercise_interval = 12 months.",
   "iso": "A.5.24; A.5.25; A.5.26",
   "nist": "IR-4; IR-8",
   "nis2": "(b)",
   "annexA": [
    {
     "code": "A.5.24",
     "verify": false
    },
    {
     "code": "A.5.25",
     "verify": false
    },
    {
     "code": "A.5.26",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>3",
    "AZP": "C/S 1>4",
    "AZW": "C/C 1>3",
    "AWS": "C/S 0>3",
    "ONP": "C/S 1>4",
    "LEG": "C/S 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Customer incident playbooks for SaaS compromise; contractual vendor incident contacts",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-001",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-IR-001",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "no playbook",
      "unknown": "not reviewed",
      "pass": "playbook exists, vendor contact tested in period"
     },
     "evidence": "Playbook in Git; contact test record",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Sentinel playbooks and ITSM incident records for cloud incidents",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IR-002",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "incident without record",
      "unknown": "ITSM data missing",
      "pass": "every sampled incident has classification, owner and closure"
     },
     "evidence": "ITSM incident records; Sentinel incidents",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits process; workload contacts and runbooks",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-003",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IR-003",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "none",
      "unknown": "not reviewed",
      "pass": "workload runbook current"
     },
     "evidence": "Runbook in Git",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "AWS incident runbooks and isolated forensic account",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-IR-004",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "none",
      "pass": "runbook and exercise in period"
     },
     "evidence": "Runbook; exercise record",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "SOC process with ITSM",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IR-005",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "otherwise",
      "unknown": "data missing",
      "pass": "as platform"
     },
     "evidence": "ITSM",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Manual escalation to the application owner and SOC",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IR-006",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "otherwise",
      "unknown": "none",
      "pass": "contact list current and exercise in period"
     },
     "evidence": "Contact list; exercise record",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-IR-002",
   "name": "Significant incident reporting",
   "statement": "A significant incident is reported to the competent authority with an early warning within {early_warning_deadline} and an incident notification within {notification_deadline} of the moment the organization becomes aware of it, and a final report follows within one month of the notification.",
   "behavior": "DETECTIVE",
   "owner": "Head of security operations with legal",
   "firstM": "M1",
   "domainGroup": "Incident management",
   "parameters": "early_warning_deadline = 24 hours; notification_deadline = 72 hours; vendor_notice_period = per contract (24 hours proposed); final report one month after notification (legal basis and dates: see 0.4).",
   "iso": "A.5.24; A.5.5; A.5.26",
   "nist": "IR-6",
   "nis2": "Art. 23 (reporting obligations); (b) for handling",
   "annexA": [
    {
     "code": "A.5.24",
     "verify": false
    },
    {
     "code": "A.5.5",
     "verify": false
    },
    {
     "code": "A.5.26",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 0>3",
    "AZP": "C/S 1>4",
    "AZW": "C/C 1>3",
    "AWS": "C/S 0>3",
    "ONP": "C/S 1>4",
    "LEG": "C/S* 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Contractual duty on the vendor to notify the customer within {vendor_notice_period} so the customer can meet its own clock; incident intake in ITSM",
     "notes": "The customer clock starts at awareness; vendor delay does not stop it.",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-007",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-IR-007",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "clause missing or notice later than clause",
      "unknown": "no vendor notice record",
      "pass": "contract clause present and vendor notices logged with timestamps"
     },
     "evidence": "Contract register; provider incident notices",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Interim manual reporting procedure (M1) with timestamps in ITSM; M3 to M4 adds detection timestamps from Sentinel to measure time-to-awareness",
     "notes": "Reporting is organization-wide; cells differ by how awareness is detected. Treat regulatory dates as external constraints, not gates (0.4).",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-008",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IR-008",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "any deadline missed",
      "unknown": "incident record lacks awareness timestamp",
      "pass": "for each significant incident in the period the early warning and notification timestamps are within the deadlines"
     },
     "evidence": "ITSM incident timestamps; Sentinel incident creation time; authority submission receipts",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Inherits the reporting process; workload owner supplies impact data",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-009",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IR-009",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "not reachable",
      "unknown": "no drill",
      "pass": "workload owner named and reachable within the early-warning window in a drill"
     },
     "evidence": "Drill record",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "Same process; GuardDuty and CloudTrail timestamps feed awareness time",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-010",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-IR-010",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "missed deadline",
      "unknown": "no timestamp",
      "pass": "as platform"
     },
     "evidence": "ITSM; GuardDuty",
     "maxAge": "P30D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Same process; SIEM alert time as awareness time",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-011",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IR-011",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "missed deadline",
      "unknown": "no timestamp",
      "pass": "as platform"
     },
     "evidence": "ITSM; SIEM",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Manual detection and escalation to the SOC; reporting through the same process",
     "notes": "Late awareness is the legacy risk.",
     "state": "impl",
     "impl": {
      "id": "IMP-IR-012",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "COMPENSATING",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-IR-012",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "otherwise",
      "unknown": "none",
      "pass": "escalation path exercised in period"
     },
     "evidence": "Exercise record",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-SR-001",
   "name": "Provider and supplier security assurance",
   "statement": "Every in-scope provider has a current assurance record (security report, certificate or attestation) mapped to the responsibilities it supports, reviewed at least every {provider_review_period}.",
   "behavior": "DETECTIVE",
   "owner": "Head of procurement and vendor risk",
   "firstM": "M4",
   "domainGroup": "Supplier and provider assurance",
   "parameters": "provider_review_period = 12 months.",
   "iso": "A.5.19; A.5.20; A.5.21; A.5.22",
   "nist": "SR-2; SR-3; SA-9 (to verify)",
   "nis2": "(d)",
   "annexA": [
    {
     "code": "A.5.19",
     "verify": false
    },
    {
     "code": "A.5.20",
     "verify": false
    },
    {
     "code": "A.5.21",
     "verify": false
    },
    {
     "code": "A.5.22",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "P/S 1>3",
    "AZP": "P/C 1>3",
    "AZW": "C/C 0>3",
    "AWS": "P/C 0>3",
    "ONP": "C/S 1>3",
    "LEG": "C/S 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Vendor assurance pack (SOC 2 Type 2, ISO/IEC 27001 certificate, penetration-test summary, data processing agreement) mapped to the vendor's PROVIDER and SHARED_* responsibilities",
     "notes": "Provider assurance is LOW confidence alone and needs a customer-side test (C §46). A certificate does not prove customer-side controls.",
     "state": "impl",
     "impl": {
      "id": "IMP-SR-001",
      "party": "PROVIDER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SR-001",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "expired or out-of-scope report",
      "unknown": "report not received",
      "pass": "report in date, scope covers the service, qualified opinions and carve-outs reviewed, complementary user entity controls assigned to customer implementations"
     },
     "evidence": "Provider SOC 2 report; ISO certificate; assurance register",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Microsoft Azure attestations (SOC 2, ISO/IEC 27001, CSP compliance offerings) from the Service Trust Portal for platform responsibilities; consumer tests for inherited controls",
     "notes": "CSP is a PROVIDER; the landing zone consumes the capability. For a financial entity, feeds the DORA register (see 0.4).",
     "state": "impl",
     "impl": {
      "id": "IMP-SR-002",
      "party": "PROVIDER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "IMPLEMENTED"
     },
     "test": {
      "id": "TST-SR-002",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "out of scope or expired",
      "unknown": "attestation missing",
      "pass": "attestation in date, region and service in scope, inheritance tested"
     },
     "evidence": "Microsoft attestations; consumer test results",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Workload-specific third parties (PaaS, marketplace, libraries) registered with assurance records",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SR-003",
      "party": "CUSTOMER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SR-003",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "gap",
      "unknown": "dependency list missing",
      "pass": "each workload dependency has a current record"
     },
     "evidence": "Dependency inventory; assurance register",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "AWS Artifact reports (SOC 2, ISO/IEC 27001 certificate, CSP attestation) and the AWS shared responsibility model mapped to responsibilities",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SR-004",
      "party": "PROVIDER",
      "origin": "COMMON",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SR-004",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "expired",
      "unknown": "not retrieved",
      "pass": "reports in date and regions in scope"
     },
     "evidence": "AWS Artifact downloads",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Hardware, software and managed-service suppliers recorded with contract and assurance record",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SR-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SR-005",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "gap",
      "unknown": "supplier list missing",
      "pass": "each critical supplier has a record in the period"
     },
     "evidence": "Contract register",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Legacy vendor or end-of-support supplier tracked; extended-support contract or acceptance recorded",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-SR-006",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-SR-006",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "unsupported without decision",
      "unknown": "status unknown",
      "pass": "support status and risk acceptance recorded"
     },
     "evidence": "Contract register; Decision record",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-PT-001",
   "name": "Personal data inventory",
   "statement": "Every in-scope system that processes personal data is recorded with its purpose, categories, processor and storage location in the record of processing activities, reviewed at least every {ropa_review_period}.",
   "behavior": "DETECTIVE",
   "owner": "Data protection officer",
   "firstM": "M4",
   "domainGroup": "Data protection and AI",
   "parameters": "ropa_review_period = 12 months.",
   "iso": "A.5.34",
   "nist": "PT-3 (to verify: PM-5(1))",
   "nis2": "n/a (GDPR Art. 30)",
   "annexA": [
    {
     "code": "A.5.34",
     "verify": false
    }
   ],
   "overview": {
    "SAAS": "SD/S 1>3",
    "AZP": "C/S 1>4",
    "AZW": "C/S 0>3",
    "AWS": "--",
    "ONP": "C/S 1>3",
    "LEG": "C/S 1>2"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "SaaS applications recorded in the record of processing with processor agreement and transfer basis",
     "notes": "Processor role is PROVIDER; customer is the controller.",
     "state": "impl",
     "impl": {
      "id": "IMP-PT-001",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-PT-001",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "missing",
      "unknown": "application unclassified",
      "pass": "every SaaS with personal data has an up-to-date record and agreement"
     },
     "evidence": "Record of processing; contract register",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Data-classification tags and Purview scanning for personal data stores",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-PT-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-PT-002",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unrecorded store",
      "unknown": "scan not run",
      "pass": "every store holding personal data is in the record"
     },
     "evidence": "Purview scan results; record of processing",
     "maxAge": "P30D",
     "stageNow": 1,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Workload privacy review in the delivery process; tags for data categories",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-PT-003",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-PT-003",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "missing",
      "unknown": "not reviewed",
      "pass": "workload record complete"
     },
     "evidence": "Privacy review record",
     "maxAge": "P365D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "No implementation record yet; Macie-style discovery to be assessed",
     "notes": "Empty cell: work item. Work item for M4.",
     "state": "empty",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "File-share and database discovery tooling plus owner attestation",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-PT-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-PT-004",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "missing",
      "unknown": "none",
      "pass": "attestation in period"
     },
     "evidence": "Discovery report; attestation",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 3
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "Manual data mapping of legacy databases",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-PT-005",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PARTIAL"
     },
     "test": {
      "id": "TST-PT-005",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "missing",
      "unknown": "none",
      "pass": "data map signed in period"
     },
     "evidence": "Signed data map",
     "maxAge": "P365D",
     "stageNow": 1,
     "stageTarget": 2
    }
   }
  },
  {
   "id": "CTL-PM-001",
   "name": "AI system inventory",
   "statement": "Every AI system in use or under development, including AI features embedded in SaaS, is recorded with its role (provider or deployer), purpose, model, data categories and risk class.",
   "behavior": "DETECTIVE",
   "owner": "Head of AI governance (role to define)",
   "firstM": "M4",
   "domainGroup": "Data protection and AI",
   "parameters": "Risk classes per the AI governance policy.",
   "iso": "none direct (A.5.9 covers assets generally)",
   "nist": "PM-5 (to verify)",
   "nis2": "n/a (AI Act obligations: see 0.4)",
   "annexA": [],
   "overview": {
    "SAAS": "SD/S 0>3",
    "AZP": "C/S 0>4",
    "AZW": "C/S 0>3",
    "AWS": "--",
    "ONP": "C/S 0>2",
    "LEG": "n/a"
   },
   "cells": {
    "SAAS": {
     "env": "SAAS",
     "mechanism": "Embedded AI features (for example assistants in office suites) identified from vendor release notes, admin settings and the CASB",
     "notes": "AI provider roles follow CSA AICM (Model Provider, Application Provider, Orchestrated Service Provider, AI Customer, CSP).",
     "state": "impl",
     "impl": {
      "id": "IMP-PM-001",
      "party": "SHARED_DEPENDENT",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-PM-001",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "enabled and unrecorded",
      "unknown": "admin setting not exposed",
      "pass": "every enabled AI feature is in the inventory with a risk class"
     },
     "evidence": "Tenant AI feature settings; CASB; inventory",
     "maxAge": "P30D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AZP": {
     "env": "AZP",
     "mechanism": "Azure AI services discovered through Resource Graph resource types; tagging policy",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-PM-002",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-PM-002",
      "method": "TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "unrecorded resource",
      "unknown": "resource type not covered",
      "pass": "every AI resource has an inventory record"
     },
     "evidence": "Azure Resource Graph; inventory",
     "maxAge": "P1D",
     "stageNow": 0,
     "stageTarget": 4
    },
    "AZW": {
     "env": "AZW",
     "mechanism": "Application teams register models and AI use in the delivery process",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-PM-003",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-PM-003",
      "method": "EXAMINE > TEST",
      "aalNow": "AAL0",
      "aalDesigned": "AAL2",
      "fail": "undeclared use found",
      "unknown": "not reviewed",
      "pass": "workload AI use declared and recorded"
     },
     "evidence": "Delivery checklist; inventory",
     "maxAge": "P90D",
     "stageNow": 0,
     "stageTarget": 3
    },
    "AWS": {
     "env": "AWS",
     "mechanism": "No implementation record yet; discovery of managed AI services to be defined",
     "notes": "Empty cell: work item. Work item for M4.",
     "state": "empty",
     "stageNow": 0,
     "stageTarget": 3
    },
    "ONP": {
     "env": "ONP",
     "mechanism": "Self-hosted models registered through the same process; GPU hosts in the CMDB",
     "notes": "",
     "state": "impl",
     "impl": {
      "id": "IMP-PM-004",
      "party": "CUSTOMER",
      "origin": "SYSTEM_SPECIFIC",
      "approach": "PRIMARY",
      "status": "PLANNED"
     },
     "test": {
      "id": "TST-PM-004",
      "method": "EXAMINE",
      "aalNow": "AAL0",
      "aalDesigned": "AAL1",
      "fail": "unrecorded",
      "unknown": "none",
      "pass": "each model host recorded"
     },
     "evidence": "CMDB; inventory",
     "maxAge": "P90D",
     "stageNow": 0,
     "stageTarget": 2
    },
    "LEG": {
     "env": "LEG",
     "mechanism": "N/A: No AI components expected; confirmed by inventory attestation and re-checked on every change",
     "notes": "implementation_status = NOT_APPLICABLE after an approved determination",
     "state": "na",
     "stageNow": null,
     "stageTarget": null
    }
   }
  }
 ]
};

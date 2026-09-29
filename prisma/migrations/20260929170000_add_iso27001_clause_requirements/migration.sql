-- ISO/IEC 27001:2022 clauses 4-10 as Requirements of the base Framework, each
-- with a Supplementary Control (origin = the base Framework) and a FULL Control
-- Mapping, plus a few PARTIAL mappings to Annex A Controls that serve a clause
-- (#75, PRD 0001 F-FW.3, ADR 0005). Content is an own-words paraphrase (ISO text
-- is licensed) and is identical to prisma/seed-data/iso27001-clauses.json, which
-- the seed loads for fresh databases; a test keeps the two in sync.
--
-- Hand-written data migration, safe to run against any database:
--   * the base Framework is selected by "isBase" = true (no hard-coded ids). If
--     there is none (fresh / empty database) every INSERT below selects zero
--     rows and nothing happens; the seed then creates everything itself;
--   * every INSERT is ON CONFLICT DO NOTHING, so rows that already exist (e.g.
--     the seed ran first) are left untouched;
--   * the new Controls are ORGANIZATIONAL, which are never assessed per System,
--     so no ControlAssessment is created or changed;
--   * ids come from gen_random_uuid() (Prisma's cuid() default is client-side).

CREATE TEMPORARY TABLE "_iso_clause_controls" (
  "code" TEXT, "title" TEXT, "description" TEXT, "category" TEXT
);
INSERT INTO "_iso_clause_controls" ("code", "title", "description", "category") VALUES
  ('ISMS-4.1', 'Organizational context understood and reviewed', 'Identify and periodically review the internal and external issues that bear on the ISMS', '4 Context of the organization'),
  ('ISMS-4.2', 'Interested parties and their requirements identified', 'Maintain a list of stakeholders and the security requirements the ISMS takes on from them', '4 Context of the organization'),
  ('ISMS-4.3', 'ISMS scope defined and maintained', 'Define, document and keep current the boundaries and applicability of the ISMS', '4 Context of the organization'),
  ('ISMS-4.4', 'ISMS established and maintained', 'Operate the ISMS as a maintained management system with defined processes and interactions', '4 Context of the organization'),
  ('ISMS-5.1', 'Top management leadership and commitment', 'Have top management sponsor, resource and promote the ISMS', '5 Leadership'),
  ('ISMS-5.2', 'Top-level information security policy', 'Issue and communicate an overarching information security policy approved by top management', '5 Leadership'),
  ('ISMS-5.3', 'ISMS roles and authorities assigned', 'Assign and communicate ISMS responsibilities and authorities, including reporting on ISMS performance', '5 Leadership'),
  ('ISMS-6.1.1', 'ISMS risks and opportunities planned', 'Identify risks and opportunities to the ISMS and plan actions to address them', '6 Planning'),
  ('ISMS-6.1.2', 'Information security risk assessment process', 'Define risk criteria and run a repeatable process to identify, analyse and evaluate information security risks', '6 Planning'),
  ('ISMS-6.1.3', 'Information security risk treatment process', 'Treat assessed risks, determine the necessary controls, maintain the Statement of Applicability and obtain risk owner approval', '6 Planning'),
  ('ISMS-6.2', 'Information security objectives set and planned', 'Set measurable information security objectives and plan how they will be achieved and evaluated', '6 Planning'),
  ('ISMS-6.3', 'ISMS changes planned', 'Plan and control changes to the ISMS', '6 Planning'),
  ('ISMS-7.1', 'ISMS resources provided', 'Determine and provide the resources the ISMS needs', '7 Support'),
  ('ISMS-7.2', 'ISMS competence ensured', 'Define required competence for security-relevant roles, close gaps and keep records', '7 Support'),
  ('ISMS-7.3', 'ISMS awareness ensured', 'Make personnel aware of the security policy, their contribution to the ISMS and the effect of not conforming', '7 Support'),
  ('ISMS-7.4', 'ISMS communication planned', 'Determine and follow internal and external communication needs for the ISMS', '7 Support'),
  ('ISMS-7.5', 'ISMS documented information controlled', 'Create, update and control ISMS documents and records', '7 Support'),
  ('ISMS-8.1', 'Operational planning and control', 'Plan, run and control the processes that deliver ISMS requirements, including outsourced ones', '8 Operation'),
  ('ISMS-8.2', 'Information security risk assessments performed', 'Perform and record risk assessments at planned intervals and on significant change', '8 Operation'),
  ('ISMS-8.3', 'Information security risk treatment implemented', 'Implement the risk treatment plan and record the outcome', '8 Operation'),
  ('ISMS-9.1', 'ISMS performance monitored and measured', 'Define, run and evaluate monitoring and measurement of security performance and ISMS effectiveness', '9 Performance evaluation'),
  ('ISMS-9.2', 'Internal audit programme', 'Plan and run an internal ISMS audit programme with impartial auditors and reported results', '9 Performance evaluation'),
  ('ISMS-9.3', 'Management review', 'Hold planned management reviews of the ISMS and record the resulting decisions', '9 Performance evaluation'),
  ('ISMS-10.1', 'Continual improvement of the ISMS', 'Continually improve the suitability, adequacy and effectiveness of the ISMS', '10 Improvement'),
  ('ISMS-10.2', 'Nonconformity and corrective action process', 'Handle nonconformities, find and remove their causes, verify the fix and keep records', '10 Improvement');

CREATE TEMPORARY TABLE "_iso_clause_requirements" (
  "code" TEXT, "section" TEXT, "title" TEXT, "text" TEXT
);
INSERT INTO "_iso_clause_requirements" ("code", "section", "title", "text") VALUES
  ('4.1', '4 Context of the organization', 'Organizational context', 'Work out which internal and external factors shape the organization''s ability to reach the results its security management system is meant to deliver, and keep that picture current.'),
  ('4.2', '4 Context of the organization', 'Stakeholder needs', 'Identify the parties with a stake in information security, such as customers, regulators and staff, and decide which of their needs and expectations the ISMS has to address.'),
  ('4.3', '4 Context of the organization', 'ISMS scope', 'Set and document the boundaries of the management system, taking into account the organizational context, stakeholder requirements and the interfaces with anything left outside the scope.'),
  ('4.4', '4 Context of the organization', 'ISMS processes', 'Establish, run, maintain and keep improving a management system, including the processes it needs and how they interact.'),
  ('5.1', '5 Leadership', 'Leadership commitment', 'Top management visibly backs the ISMS: it makes sure security objectives fit the business direction, that resources are available, and that security is part of ordinary business processes.'),
  ('5.2', '5 Leadership', 'Security policy', 'Top management sets an information security policy that fits the organization, gives a basis for objectives, commits to meeting requirements and to improvement, and is documented and communicated.'),
  ('5.3', '5 Leadership', 'Roles and authorities', 'Assign and communicate who is responsible, and has the authority, for ensuring the ISMS conforms and for reporting on its performance to top management.'),
  ('6.1.1', '6 Planning', 'Planning for risks and opportunities', 'When planning the ISMS, use the organizational context and stakeholder needs to identify the risks and opportunities that must be addressed, and plan how to act on them and check the results.'),
  ('6.1.2', '6 Planning', 'Risk assessment process', 'Define and apply a repeatable process for identifying, analysing and evaluating information security risks against agreed criteria, and keep records of the results.'),
  ('6.1.3', '6 Planning', 'Risk treatment process', 'Select treatments for the assessed risks, decide which controls are required and compare them against Annex A, document which apply and why in a Statement of Applicability, and have risk owners approve the plan and the remaining risk.'),
  ('6.2', '6 Planning', 'Security objectives', 'Set measurable security objectives at relevant functions and levels that align with the policy, and plan what will be done, by whom, with what resources, by when, and how results will be evaluated.'),
  ('6.3', '6 Planning', 'Planning of changes', 'When the management system needs to change, carry the change out in a planned way rather than ad hoc.'),
  ('7.1', '7 Support', 'Resources', 'Determine and provide the people, infrastructure, budget and other resources needed to establish, run and improve the ISMS.'),
  ('7.2', '7 Support', 'Competence', 'Decide what skills the people who affect security performance need, make sure they have them through education, training or experience, and keep evidence of it.'),
  ('7.3', '7 Support', 'Awareness', 'Make sure people working under the organization''s control know the security policy, how they contribute to the ISMS, and what follows if they do not conform.'),
  ('7.4', '7 Support', 'Communication', 'Decide what will be communicated about information security, when, to whom, by whom and through which channels, both inside and outside the organization.'),
  ('7.5', '7 Support', 'Documented information', 'Keep the documentation the ISMS requires and the organization judges necessary, and control how it is created, updated, approved, distributed, stored and retained. Covers 7.5.1 to 7.5.3 as one Requirement.'),
  ('8.1', '8 Operation', 'Operational planning and control', 'Plan, implement and control the processes needed to meet security requirements and carry out the planned actions, keep evidence that they run as planned, and manage changes and outsourced processes.'),
  ('8.2', '8 Operation', 'Risk assessment in operation', 'Carry out information security risk assessments at planned intervals or when significant changes occur, and keep the results on record.'),
  ('8.3', '8 Operation', 'Risk treatment in operation', 'Put the risk treatment plan into effect and keep a record of the treatment results.'),
  ('9.1', '9 Performance evaluation', 'Monitoring and measurement', 'Decide what to monitor and measure, how and when, and who analyses it, then use the results to judge how well security and the ISMS are performing.'),
  ('9.2', '9 Performance evaluation', 'Internal audit', 'Audit the management system internally at planned intervals against the organization''s own requirements and the standard, using a defined programme, impartial auditors and reported, retained results. Covers 9.2.1 and 9.2.2 as one Requirement.'),
  ('9.3', '9 Performance evaluation', 'Management review', 'Top management reviews the ISMS at planned intervals to confirm it stays suitable, adequate and effective, and records its decisions on improvements and changes. Covers 9.3.1 to 9.3.3 as one Requirement.'),
  ('10.1', '10 Improvement', 'Continual improvement', 'Keep improving the suitability, adequacy and effectiveness of the management system.'),
  ('10.2', '10 Improvement', 'Nonconformity and corrective action', 'When something does not meet requirements, react to it and deal with the consequences, investigate the cause and fix it so it does not recur, check the fix worked, and keep records.');

CREATE TEMPORARY TABLE "_iso_clause_mappings" (
  "requirementCode" TEXT, "controlCode" TEXT, "coverage" TEXT, "rationale" TEXT
);
INSERT INTO "_iso_clause_mappings" ("requirementCode", "controlCode", "coverage", "rationale") VALUES
  ('4.1', 'ISMS-4.1', 'FULL', NULL),
  ('4.2', 'ISMS-4.2', 'FULL', NULL),
  ('4.2', 'A.5.31', 'PARTIAL', 'Legal, statutory and regulatory requirements (A.5.31) are one important subset of stakeholder requirements; contractual and other stakeholder expectations are not covered by it, so the mapping is partial.'),
  ('4.3', 'ISMS-4.3', 'FULL', NULL),
  ('4.4', 'ISMS-4.4', 'FULL', NULL),
  ('5.1', 'ISMS-5.1', 'FULL', NULL),
  ('5.1', 'A.5.4', 'PARTIAL', 'Management responsibilities (A.5.4) covers managers enforcing security policy, a narrower duty than top management''s overall ownership and sponsorship of the ISMS.'),
  ('5.2', 'ISMS-5.2', 'FULL', NULL),
  ('5.2', 'A.5.1', 'PARTIAL', 'Policies for information security (A.5.1) covers approving and reviewing the policy set; the top-level policy also carries specific commitments and communication expectations that A.5.1 does not spell out.'),
  ('5.3', 'ISMS-5.3', 'FULL', NULL),
  ('5.3', 'A.5.2', 'PARTIAL', 'Information security roles and responsibilities (A.5.2) covers assigning security roles generally; the clause specifically requires responsibility for ISMS conformity and for reporting to top management.'),
  ('6.1.1', 'ISMS-6.1.1', 'FULL', NULL),
  ('6.1.2', 'ISMS-6.1.2', 'FULL', NULL),
  ('6.1.3', 'ISMS-6.1.3', 'FULL', NULL),
  ('6.2', 'ISMS-6.2', 'FULL', NULL),
  ('6.3', 'ISMS-6.3', 'FULL', NULL),
  ('7.1', 'ISMS-7.1', 'FULL', NULL),
  ('7.2', 'ISMS-7.2', 'FULL', NULL),
  ('7.2', 'A.6.3', 'PARTIAL', 'Awareness, education and training (A.6.3) is one way to build competence, but the clause also covers defining the skills needed, competence gained through experience and keeping evidence, so the mapping is partial.'),
  ('7.3', 'ISMS-7.3', 'FULL', NULL),
  ('7.3', 'A.6.3', 'PARTIAL', 'The awareness and training programme in A.6.3 delivers this awareness; the clause frames what people should understand in relation to the ISMS itself, so the mapping is partial.'),
  ('7.4', 'ISMS-7.4', 'FULL', NULL),
  ('7.5', 'ISMS-7.5', 'FULL', NULL),
  ('7.5', 'A.5.37', 'PARTIAL', 'Documented operating procedures (A.5.37) covers documenting operating procedures; the clause applies to all ISMS documented information, including how it is created, updated and controlled, so the mapping is partial.'),
  ('8.1', 'ISMS-8.1', 'FULL', NULL),
  ('8.2', 'ISMS-8.2', 'FULL', NULL),
  ('8.3', 'ISMS-8.3', 'FULL', NULL),
  ('9.1', 'ISMS-9.1', 'FULL', NULL),
  ('9.2', 'ISMS-9.2', 'FULL', NULL),
  ('9.2', 'A.5.35', 'PARTIAL', 'Independent review of information security (A.5.35) can be met by internal audit, but the clause sets specific programme, criteria and reporting expectations beyond a periodic independent review, so the mapping is partial.'),
  ('9.3', 'ISMS-9.3', 'FULL', NULL),
  ('10.1', 'ISMS-10.1', 'FULL', NULL),
  ('10.2', 'ISMS-10.2', 'FULL', NULL);

-- Supplementary Controls, origin = the base Framework.
INSERT INTO "Control" ("id", "code", "title", "description", "category", "mandatory", "applicability", "examples", "question", "intent", "originFrameworkId")
SELECT gen_random_uuid()::text, t."code", t."title", t."description", t."category", true, 'ORGANIZATIONAL', ARRAY[]::text[], NULL, NULL, f."id"
FROM "_iso_clause_controls" t
CROSS JOIN (SELECT "id" FROM "Framework" WHERE "isBase" ORDER BY "id" LIMIT 1) f
ON CONFLICT ("code") DO NOTHING;

-- Clause Requirements.
INSERT INTO "Requirement" ("id", "frameworkId", "code", "section", "title", "text", "updatedAt")
SELECT gen_random_uuid()::text, f."id", t."code", t."section", t."title", t."text", CURRENT_TIMESTAMP
FROM "_iso_clause_requirements" t
CROSS JOIN (SELECT "id" FROM "Framework" WHERE "isBase" ORDER BY "id" LIMIT 1) f
ON CONFLICT ("frameworkId", "code") DO NOTHING;

-- Control Mappings, joined on codes.
INSERT INTO "ControlMapping" ("id", "requirementId", "controlId", "coverage", "rationale", "updatedAt")
SELECT gen_random_uuid()::text, r."id", c."id", m."coverage"::"ControlCoverage", m."rationale", CURRENT_TIMESTAMP
FROM "_iso_clause_mappings" m
CROSS JOIN (SELECT "id" FROM "Framework" WHERE "isBase" ORDER BY "id" LIMIT 1) f
JOIN "Requirement" r ON r."frameworkId" = f."id" AND r."code" = m."requirementCode"
JOIN "Control" c ON c."code" = m."controlCode"
ON CONFLICT ("requirementId", "controlId") DO NOTHING;

DROP TABLE "_iso_clause_mappings";
DROP TABLE "_iso_clause_requirements";
DROP TABLE "_iso_clause_controls";

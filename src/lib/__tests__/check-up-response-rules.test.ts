import { describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import {
  canAnswerCheckUp,
  canReadCheckUp,
  checkUpProgress,
  checkUpRecipientId,
  checkUpResponseRefusal,
  descriptionRequired,
  isCheckUpOpen,
  isCheckUpOverdue,
  MAX_DESCRIPTION_LENGTH,
  MAX_EVIDENCE_LINKS,
  normalizeEvidenceLinks,
  safeHttpUrl,
  validateCheckUpResponse,
} from "@/lib/check-up-response-rules";

const ALL_ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "RISK_OWNER",
  "SYSTEM_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
  "INTERNAL_AUDITOR",
];

describe("checkUpRecipientId", () => {
  it("is the System's owner for a System-level Check-up, whoever owns the Control", () => {
    expect(checkUpRecipientId({ system: { ownerId: "so" }, control: { ownerId: "co" } })).toBe("so");
    expect(checkUpRecipientId({ system: { ownerId: "so" }, control: { ownerId: null } })).toBe("so");
  });

  it("is the Control Owner for an Organization-level Check-up, or nobody", () => {
    expect(checkUpRecipientId({ system: null, control: { ownerId: "co" } })).toBe("co");
    expect(checkUpRecipientId({ system: null, control: { ownerId: null } })).toBeNull();
  });
});

describe("who may answer and who may read", () => {
  it("lets only the recipient answer, whatever the role, except the Internal Auditor", () => {
    for (const role of ALL_ROLES) {
      expect(canAnswerCheckUp({ id: "r", role }, "r")).toBe(role !== "INTERNAL_AUDITOR");
      expect(canAnswerCheckUp({ id: "other", role }, "r")).toBe(false);
    }
  });

  it("lets nobody answer a Check-up without a recipient", () => {
    expect(canAnswerCheckUp({ id: "x", role: "ADMIN" }, null)).toBe(false);
  });

  it("lets the recipient and the audit-reading roles read, and nobody else", () => {
    for (const role of ALL_ROLES) {
      const reading = ["ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER", "INTERNAL_AUDITOR"].includes(role);
      expect(canReadCheckUp({ id: "other", role }, "r")).toBe(reading);
      expect(canReadCheckUp({ id: "r", role }, "r")).toBe(true);
      expect(canReadCheckUp({ id: "other", role }, null)).toBe(reading);
    }
  });
});

describe("open and overdue", () => {
  const dueDate = new Date("2026-11-10T00:00:00.000Z");
  const open = { auditStatus: "LAUNCHED", answered: false, withdrawn: false, dueDate } as const;

  it("is open only while the audit is launched and nothing is answered", () => {
    expect(isCheckUpOpen(open)).toBe(true);
    expect(isCheckUpOpen({ ...open, answered: true })).toBe(false);
    expect(isCheckUpOpen({ ...open, auditStatus: "CLOSED" })).toBe(false);
    expect(isCheckUpOpen({ ...open, auditStatus: "DRAFT" })).toBe(false);
  });

  it("is not open once withdrawn: it leaves the recipient's tasks (#158)", () => {
    expect(isCheckUpOpen({ ...open, withdrawn: true })).toBe(false);
    expect(isCheckUpOverdue({ ...open, withdrawn: true }, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("is overdue from the day after the due date, compared in UTC", () => {
    expect(isCheckUpOverdue(open, new Date("2026-11-09T23:59:59.999Z"))).toBe(false); // due date tomorrow
    expect(isCheckUpOverdue(open, new Date("2026-11-10T00:00:00.000Z"))).toBe(false); // due today
    expect(isCheckUpOverdue(open, new Date("2026-11-10T23:59:59.999Z"))).toBe(false);
    expect(isCheckUpOverdue(open, new Date("2026-11-11T00:00:00.000Z"))).toBe(true); // due yesterday
  });

  it("is never overdue once answered, or when the audit isn't launched", () => {
    const late = new Date("2027-01-01T00:00:00.000Z");
    expect(isCheckUpOverdue({ ...open, answered: true }, late)).toBe(false);
    expect(isCheckUpOverdue({ ...open, auditStatus: "CLOSED" }, late)).toBe(false);
  });
});

describe("checkUpResponseRefusal", () => {
  it("allows a launched audit and refuses a draft or closed one", () => {
    expect(checkUpResponseRefusal({ auditStatus: "LAUNCHED", evaluated: false, withdrawn: false })).toBeNull();
    expect(checkUpResponseRefusal({ auditStatus: "CLOSED", evaluated: false, withdrawn: false })).toMatch(/closed/);
    expect(checkUpResponseRefusal({ auditStatus: "DRAFT", evaluated: false, withdrawn: false })).toMatch(/draft/);
  });

  it("refuses an evaluated Check-up's response, whatever the audit's state (#156)", () => {
    expect(checkUpResponseRefusal({ auditStatus: "LAUNCHED", evaluated: true, withdrawn: false })).toMatch(/evaluated/);
    expect(checkUpResponseRefusal({ auditStatus: "CLOSED", evaluated: true, withdrawn: false })).toMatch(/evaluated/);
  });
});

describe("checkUpProgress", () => {
  it("counts sent, answered, evaluated, awaiting evaluation, withdrawn, open and overdue", () => {
    expect(checkUpProgress([])).toEqual({ sent: 0, answered: 0, evaluated: 0, awaitingEvaluation: 0, withdrawn: 0, open: 0, overdue: 0 });
    expect(
      checkUpProgress([
        { answered: true, evaluated: true, withdrawn: false, overdue: false },
        { answered: true, evaluated: false, withdrawn: false, overdue: false },
        { answered: false, evaluated: false, withdrawn: false, overdue: true },
        { answered: false, evaluated: false, withdrawn: false, overdue: false },
      ]),
    ).toEqual({ sent: 4, answered: 2, evaluated: 1, awaitingEvaluation: 1, withdrawn: 0, open: 2, overdue: 1 });
  });

  it("counts a withdrawn Check-up only as withdrawn, an answered one included (#158)", () => {
    expect(
      checkUpProgress([
        { answered: true, evaluated: true, withdrawn: false, overdue: false },
        { answered: true, evaluated: false, withdrawn: true, overdue: false },
        { answered: false, evaluated: false, withdrawn: true, overdue: false },
        { answered: false, evaluated: false, withdrawn: false, overdue: true },
      ]),
    ).toEqual({ sent: 4, answered: 1, evaluated: 1, awaitingEvaluation: 0, withdrawn: 2, open: 1, overdue: 1 });
  });
});

describe("evidence links", () => {
  it.each([
    "https://example.com/policy.pdf",
    "http://intranet.example.com:8080/a?b=c#d",
    "  https://example.com/trimmed  ",
  ])("accepts %s", (value) => {
    expect(safeHttpUrl(value)).toBe(value.trim());
  });

  it.each([
    "",
    "   ",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "mailto:a@example.com",
    "//example.com/x",
    "/relative/path",
    "example.com",
    "not a url",
    "https://",
    `https://example.com/${"a".repeat(2100)}`,
  ])("rejects %j", (value) => {
    expect(safeHttpUrl(value)).toBeNull();
    if (value.trim() !== "") expect(normalizeEvidenceLinks([value]).problems).toHaveLength(1);
  });

  it("trims, drops blanks and duplicates and keeps the order", () => {
    expect(normalizeEvidenceLinks([" https://a.example ", "", "https://b.example", "https://a.example"])).toEqual({
      links: ["https://a.example", "https://b.example"],
      problems: [],
    });
  });

  it("refuses more than the cap", () => {
    const many = Array.from({ length: MAX_EVIDENCE_LINKS + 1 }, (_, i) => `https://example.com/${i}`);
    expect(normalizeEvidenceLinks(many).problems).toEqual([`At most ${MAX_EVIDENCE_LINKS} evidence links`]);
    expect(normalizeEvidenceLinks(many.slice(1)).problems).toEqual([]);
  });
});

describe("validateCheckUpResponse", () => {
  const questions = [
    { id: "q2", position: 2 },
    { id: "q1", position: 1 },
  ];
  const good = {
    answers: [
      { questionId: "q1", answer: "YES" },
      { questionId: "q2", answer: "NO", description: "  Not yet  " },
    ],
  };

  it("requires a description for No and N/A only", () => {
    expect(descriptionRequired("YES")).toBe(false);
    expect(descriptionRequired("NO")).toBe(true);
    expect(descriptionRequired("NA")).toBe(true);
  });

  it("accepts a complete submission and returns it cleaned, in question order", () => {
    const { response, problems } = validateCheckUpResponse({ ...good, evidenceLinks: [" https://a.example "] }, questions);
    expect(problems).toEqual([]);
    expect(response).toEqual({
      answers: [
        { questionId: "q1", answer: "YES", description: "" },
        { questionId: "q2", answer: "NO", description: "Not yet" },
      ],
      evidenceLinks: ["https://a.example"],
    });
  });

  it("requires every question to be answered", () => {
    const { problems } = validateCheckUpResponse({ answers: [good.answers[0]] }, questions);
    expect(problems).toEqual(["Question 2 needs an answer: Yes, No or N/A"]);
    expect(validateCheckUpResponse({ answers: [] }, questions).problems).toHaveLength(2);
  });

  it("refuses an unknown answer, a repeated question and a question that isn't the Check-up's", () => {
    expect(validateCheckUpResponse({ answers: [{ questionId: "q1", answer: "MAYBE" }, good.answers[1]] }, questions).problems).toEqual([
      "Question 1 needs an answer: Yes, No or N/A",
    ]);
    expect(validateCheckUpResponse({ answers: [...good.answers, good.answers[0]] }, questions).problems).toEqual([
      "A question is answered more than once",
    ]);
    expect(validateCheckUpResponse({ answers: [...good.answers, { questionId: "zzz", answer: "YES" }] }, questions).problems).toEqual([
      "An answer is for a question that is not part of this Check-up",
    ]);
  });

  it("requires a description for No and N/A, and caps its length", () => {
    expect(
      validateCheckUpResponse({ answers: [{ questionId: "q1", answer: "NA", description: "  " }, { questionId: "q2", answer: "YES" }] }, questions)
        .problems,
    ).toEqual(["Question 1: a description is required for N/A"]);
    expect(
      validateCheckUpResponse(
        { answers: [{ questionId: "q1", answer: "YES", description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1) }, { questionId: "q2", answer: "YES" }] },
        questions,
      ).problems,
    ).toHaveLength(1);
  });

  it("refuses an evidence link that isn't http(s)", () => {
    expect(validateCheckUpResponse({ ...good, evidenceLinks: ["javascript:alert(1)"] }, questions).problems).toHaveLength(1);
  });
});

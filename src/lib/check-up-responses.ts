import { Prisma, type CheckUpAnswer, type InternalAuditStatus, type UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatCalendarDate } from "@/lib/internal-audit-rules";
import {
  canAnswerCheckUp,
  canReadCheckUp,
  checkUpRecipientId,
  checkUpResponseRefusal,
  isCheckUpOpen,
  isCheckUpOverdue,
  safeHttpUrl,
  validateCheckUpResponse,
  type ResponseInput,
} from "@/lib/check-up-response-rules";

/**
 * One Check-up and its response (PRD 0001 F-IA.4, F-IA.5, #155): the read the Check-up page and
 * `GET /api/check-ups/[id]` share, and the write that creates or replaces the response. Who may
 * call them is decided here from the Check-up's derived recipient, so the page, the route and the
 * tests can't disagree. Submitting writes the response and its answers and nothing else: no
 * status, no Risk, no Change Event.
 *
 * Every read a write depends on uses the transaction client (see the supervised-workflow
 * gotchas), and both functions run in a REPEATABLE READ snapshot, so a Check-up read together with
 * its owners, questions and answers is one consistent picture.
 */

const SNAPSHOT = { isolationLevel: "RepeatableRead" } as const;

/** A refusal with the HTTP status the route answers with. */
export class CheckUpResponseError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
    readonly problems: string[] = [message],
  ) {
    super(message);
  }
}

export type CheckUpDetail = {
  id: string;
  audit: { id: string; title: string; status: InternalAuditStatus; dueDate: string };
  control: { id: string; code: string; title: string };
  target: { kind: "system"; id: string; name: string } | { kind: "organization" };
  /** Whoever owns the target now, or null (an Organization-level Check-up whose Control has no Control Owner). */
  recipient: { id: string; name: string } | null;
  questions: { id: string; position: number; text: string; answer: { answer: CheckUpAnswer; description: string } | null }[];
  response: {
    respondedBy: { id: string; name: string };
    respondedAt: string;
    lastChangedBy: { id: string; name: string };
    updatedAt: string;
    /** Only values that pass the http(s) check: a stored value that doesn't is dropped, never linked. */
    evidenceLinks: string[];
  } | null;
  answered: boolean;
  open: boolean;
  overdue: boolean;
};

/** Everything about one Check-up, or null if there is none. Authorisation is the caller's (`checkUpAccess`). */
export async function getCheckUpDetail(id: string, now = new Date()): Promise<CheckUpDetail | null> {
  return prisma.$transaction(async (tx) => {
    const checkUp = await tx.checkUp.findUnique({
      where: { id },
      select: {
        id: true,
        internalAudit: { select: { id: true, title: true, status: true, dueDate: true } },
        control: { select: { id: true, code: true, title: true, ownerId: true } },
        system: { select: { id: true, name: true, ownerId: true } },
        questions: { orderBy: { position: "asc" }, select: { id: true, position: true, text: true, answer: { select: { answer: true, description: true } } } },
        response: {
          select: {
            respondedAt: true,
            updatedAt: true,
            evidenceLinks: true,
            respondedBy: { select: { id: true, name: true } },
            lastChangedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!checkUp) return null;

    const recipientId = checkUpRecipientId({ system: checkUp.system, control: checkUp.control });
    const recipient = recipientId ? await tx.user.findUnique({ where: { id: recipientId }, select: { id: true, name: true } }) : null;
    const answered = checkUp.response !== null;
    const state = { auditStatus: checkUp.internalAudit.status, answered, dueDate: checkUp.internalAudit.dueDate };

    return {
      id: checkUp.id,
      audit: {
        id: checkUp.internalAudit.id,
        title: checkUp.internalAudit.title,
        status: checkUp.internalAudit.status,
        dueDate: formatCalendarDate(checkUp.internalAudit.dueDate),
      },
      control: { id: checkUp.control.id, code: checkUp.control.code, title: checkUp.control.title },
      target: checkUp.system ? { kind: "system", id: checkUp.system.id, name: checkUp.system.name } : { kind: "organization" },
      recipient,
      questions: checkUp.questions,
      response: checkUp.response && {
        respondedBy: checkUp.response.respondedBy,
        respondedAt: checkUp.response.respondedAt.toISOString(),
        lastChangedBy: checkUp.response.lastChangedBy,
        updatedAt: checkUp.response.updatedAt.toISOString(),
        evidenceLinks: checkUp.response.evidenceLinks.flatMap((link) => {
          const safe = safeHttpUrl(link);
          return safe ? [safe] : [];
        }),
      },
      answered,
      open: isCheckUpOpen(state),
      overdue: isCheckUpOverdue(state, now),
    };
  }, SNAPSHOT);
}

/** What `user` may do with a Check-up: read it, and answer (create or change the response) it. */
export function checkUpAccess(user: { id: string; role: UserRole }, checkUp: Pick<CheckUpDetail, "recipient" | "audit">) {
  const recipientId = checkUp.recipient?.id ?? null;
  return {
    canRead: canReadCheckUp(user, recipientId),
    canAnswer: canAnswerCheckUp(user, recipientId) && checkUpResponseRefusal({ auditStatus: checkUp.audit.status }) === null,
  };
}

/**
 * Creates `checkUpId`'s response, or replaces it if one exists (a submitted response can be
 * changed until the Check-up is evaluated, #156). Throws `CheckUpResponseError`: 404 if there is no
 * such Check-up, 403 unless `user` is its recipient *now* (an Admin who isn't the recipient is
 * refused too; so is an Internal Auditor, and so is everyone when the Control has no Control
 * Owner), 409 if `checkUpResponseRefusal` says the response is locked, 400 if the submission is
 * invalid. Refusals change nothing. If the recipient changed after a response was submitted, the
 * new recipient changes it and becomes its `lastChangedBy`.
 */
export async function submitCheckUpResponse(
  checkUpId: string,
  user: { id: string; role: UserRole },
  input: ResponseInput | null,
  now = new Date(),
): Promise<{ created: boolean }> {
  return prisma.$transaction(async (tx) => {
    const checkUp = await tx.checkUp.findUnique({
      where: { id: checkUpId },
      select: {
        internalAudit: { select: { status: true } },
        control: { select: { ownerId: true } },
        system: { select: { ownerId: true } },
        questions: { select: { id: true, position: true } },
        response: { select: { id: true } },
      },
    });
    if (!checkUp) throw new CheckUpResponseError(404, "Check-up not found");

    const recipientId = checkUpRecipientId({ system: checkUp.system, control: checkUp.control });
    if (!canAnswerCheckUp(user, recipientId)) {
      throw new CheckUpResponseError(403, "Only the recipient of a Check-up can answer it");
    }
    const refusal = checkUpResponseRefusal({ auditStatus: checkUp.internalAudit.status });
    if (refusal) throw new CheckUpResponseError(409, refusal);

    // `null` is a body of the wrong shape; the refusals above come first, so a non-recipient learns nothing from it.
    if (input === null) throw new CheckUpResponseError(400, "Invalid Check-up response");
    const { response, problems } = validateCheckUpResponse(input, checkUp.questions);
    if (problems.length > 0) throw new CheckUpResponseError(400, problems.join("; "), problems);

    const answers = response.answers.map(({ questionId, answer, description }) => ({ questionId, answer, description }));
    if (checkUp.response) {
      await tx.checkUpResponse.update({
        where: { id: checkUp.response.id },
        data: { lastChangedById: user.id, evidenceLinks: response.evidenceLinks },
      });
      await tx.checkUpResponseAnswer.deleteMany({ where: { responseId: checkUp.response.id } });
      await tx.checkUpResponseAnswer.createMany({ data: answers.map((a) => ({ ...a, responseId: checkUp.response!.id })) });
      return { created: false };
    }
    await tx.checkUpResponse.create({
      data: {
        checkUpId,
        respondedById: user.id,
        respondedAt: now,
        lastChangedById: user.id,
        evidenceLinks: response.evidenceLinks,
        answers: { create: answers },
      },
    });
    return { created: true };
  }, SNAPSHOT);
}

/**
 * The body of PUT /api/check-ups/[id]/response. The shape only: whether every question is
 * answered, the descriptions and the links are `validateCheckUpResponse`'s, which names each problem.
 */
export const checkUpResponseBodySchema = z.object({
  answers: z.array(z.object({ questionId: z.string(), answer: z.string(), description: z.string().optional() })),
  evidenceLinks: z.array(z.string()).optional(),
});

/** Answers a `CheckUpResponseError` (or a concurrent write) as JSON; rethrows anything else. */
export function checkUpResponseErrorResponse(error: unknown): NextResponse {
  if (error instanceof CheckUpResponseError) {
    return NextResponse.json({ error: error.message, problems: error.problems }, { status: error.status });
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002" || error.code === "P2003" || error.code === "P2025")
  ) {
    return NextResponse.json({ error: "The Check-up changed at the same moment; try again" }, { status: 409 });
  }
  throw error;
}

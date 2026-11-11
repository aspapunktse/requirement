import { z } from "zod";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { ALL_ROLES, roleName, type AdminUser, type UserHoldings } from "@/lib/user-admin-shared";

/**
 * Admin -> Users (#364): creating Users, changing their name, email and role. Admin only (the routes check).
 *
 * - The email is stored trimmed and lowercased and is unique case-insensitively (Users from the seed may keep a
 *   mixed-case email, so the check compares lowercased, not just the unique index).
 * - A role change is allowed whatever the User still holds (product-owner decision 1a): Systems they own, Business
 *   System Owner assignments, Business Unit and Framework scopes all stay. `describeHoldings` tells the page what.
 * - The last Admin can't be demoted (decision 2a): refused with 409 under an advisory lock inside the transaction,
 *   so two concurrent demotions can't both pass.
 * - Every change and its Change Event commit together; every query inside the transaction uses `tx`.
 */

export const MAX_USER_NAME_LENGTH = 120;
export const MAX_USER_EMAIL_LENGTH = 254;

const nameField = z.string().trim().min(1, "Name is required").max(MAX_USER_NAME_LENGTH, `Name can be at most ${MAX_USER_NAME_LENGTH} characters`);
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .max(MAX_USER_EMAIL_LENGTH, "Email is too long")
  .pipe(z.email("Enter a valid email address"));
const roleField = z.enum(ALL_ROLES as [UserRole, ...UserRole[]], { error: "Pick a role" });

export const createUserSchema = z.object({ name: nameField, email: emailField, role: roleField }).strict();
/** A PATCH changes any of the three; at least one is required. */
export const updateUserSchema = z
  .object({ name: nameField.optional(), email: emailField.optional(), role: roleField.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export type UserResult = { ok: true; user: AdminUser; changed: boolean } | { ok: false; status: number; error: string };

const DUPLICATE_EMAIL = "A User with this email already exists";
export const LAST_ADMIN_REFUSAL = "This is the last Admin. Make another User an Admin first.";

const toAdminUser = (user: { id: string; name: string; email: string; role: UserRole; createdAt: Date }): AdminUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt.toISOString(),
});

type Tx = Prisma.TransactionClient;

/** Another User (not `exceptId`) already has this email, compared case-insensitively. */
async function emailTaken(tx: Tx, email: string, exceptId?: string) {
  const found = await tx.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return found !== null;
}

/** The unique index lost a race with another create: the same answer as the check. */
const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Serialises everything that can remove an Admin. Held until the transaction ends. */
async function lockAdminChanges(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user-admin-role-change'))`;
}

/** How many Admins besides `userId` there are. Called under `lockAdminChanges`. */
export type CountOtherAdmins = (tx: Tx, userId: string) => Promise<number>;
const countOtherAdminsInDb: CountOtherAdmins = (tx, userId) => tx.user.count({ where: { role: "ADMIN", id: { not: userId } } });

export async function createUser(actorId: string, input: CreateUserInput): Promise<UserResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (await emailTaken(tx, input.email)) return { ok: false, status: 409, error: DUPLICATE_EMAIL } as const;
      const user = await tx.user.create({ data: { name: input.name, email: input.email, role: input.role } });
      await logChangeEvent(null, "USER_CREATED", `Created User ${user.name} (${user.email}) with role ${roleName(user.role)}`, actorId, tx);
      return { ok: true, user: toAdminUser(user), changed: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, status: 409, error: DUPLICATE_EMAIL };
    throw error;
  }
}

export async function updateUser(
  actorId: string,
  userId: string,
  input: UpdateUserInput,
  countOtherAdmins: CountOtherAdmins = countOtherAdminsInDb,
): Promise<UserResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Lock first, then read: a concurrent demotion has either finished (and is seen) or waits for this one.
      await lockAdminChanges(tx);
      const before = await tx.user.findUnique({ where: { id: userId } });
      if (!before) return { ok: false, status: 404, error: "User not found" } as const;

      const nameChanged = input.name !== undefined && input.name !== before.name;
      const emailChanged = input.email !== undefined && input.email !== before.email;
      const roleChanged = input.role !== undefined && input.role !== before.role;
      if (!nameChanged && !emailChanged && !roleChanged) return { ok: true, user: toAdminUser(before), changed: false } as const;

      if (emailChanged && (await emailTaken(tx, input.email!, userId))) return { ok: false, status: 409, error: DUPLICATE_EMAIL } as const;
      if (roleChanged && before.role === "ADMIN" && (await countOtherAdmins(tx, userId)) === 0) {
        return { ok: false, status: 409, error: LAST_ADMIN_REFUSAL } as const;
      }

      const user = await tx.user.update({
        where: { id: userId },
        data: {
          ...(nameChanged ? { name: input.name } : {}),
          ...(emailChanged ? { email: input.email } : {}),
          ...(roleChanged ? { role: input.role } : {}),
        },
      });

      if (nameChanged || emailChanged) {
        const parts = [
          ...(nameChanged ? [`name from ${before.name} to ${user.name}`] : []),
          ...(emailChanged ? [`email from ${before.email} to ${user.email}`] : []),
        ];
        await logChangeEvent(null, "USER_RENAMED", `Changed ${parts.join(" and ")}`, actorId, tx);
      }
      if (roleChanged) {
        await logChangeEvent(null, "USER_ROLE_CHANGED", `Changed ${user.name}'s role from ${roleName(before.role)} to ${roleName(user.role)}`, actorId, tx);
      }
      return { ok: true, user: toAdminUser(user), changed: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, status: 409, error: DUPLICATE_EMAIL };
    throw error;
  }
}

/** Every User with their holdings, sorted by name, read in one snapshot. */
export async function listUsersWithHoldings(): Promise<(AdminUser & { holdings: UserHoldings })[]> {
  return prisma.$transaction(
    async (tx) => {
      const users = await tx.user.findMany({
        orderBy: [{ name: "asc" }, { email: "asc" }],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          _count: { select: { ownedSystems: true, businessOwnedSystems: true, businessUnitScopes: true, frameworkScopes: true } },
        },
      });
      return users.map(({ _count, ...user }) => ({
        ...toAdminUser(user),
        holdings: {
          ownedSystems: _count.ownedSystems,
          businessOwnedSystems: _count.businessOwnedSystems,
          businessUnitScopes: _count.businessUnitScopes,
          frameworkScopes: _count.frameworkScopes,
        },
      }));
    },
    { isolationLevel: "RepeatableRead" },
  );
}

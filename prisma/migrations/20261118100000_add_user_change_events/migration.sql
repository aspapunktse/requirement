-- AlterEnum
-- The Change Events of Admin -> Users (#364): a User created, renamed (name or email) and given another role. No data change,
-- and the values are not used in this migration (a new enum value can't be).
ALTER TYPE "ChangeEventAction" ADD VALUE 'USER_CREATED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'USER_RENAMED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'USER_ROLE_CHANGED';

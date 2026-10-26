-- A System's owner can be changed (#233): the Change Event it records. No rows are touched.
ALTER TYPE "ChangeEventAction" ADD VALUE 'SYSTEM_OWNER_CHANGED';

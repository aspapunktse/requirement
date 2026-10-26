-- An Admin can change an App Setting (#240): the Change Event it records. No rows are touched.
ALTER TYPE "ChangeEventAction" ADD VALUE 'APP_SETTING_CHANGED';

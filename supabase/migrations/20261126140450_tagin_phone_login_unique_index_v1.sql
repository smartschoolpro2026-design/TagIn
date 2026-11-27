-- Prevent two accounts from sharing the same phone digits even if formatting differs.
-- Phone values are still stored in E.164 form by the account-provisioning workflow.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_digits_unique
ON public.profiles ((regexp_replace(phone, '[^0-9]', '', 'g')))
WHERE phone IS NOT NULL AND btrim(phone) <> '';

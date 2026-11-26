-- Prevent two accounts from sharing the same phone digits even if formatting differs.
-- The provisioning workflow stores phone values in canonical E.164 form.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_digits_unique
ON public.profiles ((regexp_replace(phone, '[^0-9]', '', 'g')))
WHERE phone IS NOT NULL AND btrim(phone) <> '';

create or replace function private.enforce_temporary_password_expiry()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
 if new.must_change_password then
  if new.temporary_password_expires_at is null then
   new.temporary_password_expires_at:=now()+interval '24 hours';
  end if;
 else
  new.temporary_password_expires_at:=null;
 end if;
 return new;
end;
$$;
grant execute on function private.enforce_temporary_password_expiry() to authenticated,service_role;
drop trigger if exists enforce_temporary_password_expiry on public.profiles;
create trigger enforce_temporary_password_expiry before insert or update of must_change_password,temporary_password_expires_at on public.profiles
for each row execute function private.enforce_temporary_password_expiry();
update public.profiles set temporary_password_expires_at=now()+interval '24 hours'
where must_change_password=true and temporary_password_expires_at is null;

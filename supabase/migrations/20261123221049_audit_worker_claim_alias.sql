-- Avoid collision between the claimed report record and the maintenance-query alias.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.aisas_claim_audit(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'from public.audit_reports r where r.list_id=a.id and r.status','from public.audit_reports pending_report where pending_report.list_id=a.id and pending_report.status');
 execute definition;
end $$;

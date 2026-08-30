-- Reintenta entregas Push de Operaciones que siguen pendientes o fallaron.
-- La URL y el secreto se resuelven desde Vault en cada ejecución.
select cron.schedule(
  'web-push-retry',
  '* * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'web_push_function_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-web-push-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'web_push_dispatch_secret'
        )
      ),
      body := jsonb_build_object('deliveryId', due.id)
    ) as request_id
    from (
      select id
      from public.notification_deliveries
      where source_app = 'operaciones'
        and channel = 'push'
        and status in ('pending', 'failed')
        and coalesce(next_attempt_at, now()) <= now()
      order by next_attempt_at nulls first, created_at, id
      limit 50
    ) as due;
  $job$
);

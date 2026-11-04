-- Datos sintéticos para medir el costo de las queries con una base más grande que el seed (issue #115).
-- Se suman al seed de api/src/db/seed.ts (no lo reemplazan) y se pueden quitar con el DELETE del final.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/qa/bulk-data.sql
--
-- Tamaños: 2.000 usuarios, 3.000 equipos, 20.000 tickets (75 % resueltos), 10.000 préstamos,
-- 10.000 solicitudes de servicio y 5.000 comentarios. Los préstamos "active" tienen devolución en el
-- futuro: ninguno pasa a "vencido" y el tablero no dispara la sincronización de vencidos.
-- Solo para una base de pruebas: no correr contra una base con datos reales.

begin;

create function pg_temp.iso(ts timestamp) returns text language sql immutable as
$$ select to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

insert into users (id, name, dni, email, role, is_active, student_subjects, password_hash, token_version, created_at, updated_at)
select 'u-bulk-' || i, 'Usuario ' || i, (70000000 + i)::text, 'bulk' || i || '@example.test', 'solicitante', true,
       '[]'::jsonb, (select password_hash from users where id = 'u-sol-1'), 0,
       pg_temp.iso(now() at time zone 'utc'), pg_temp.iso(now() at time zone 'utc')
from generate_series(1, 2000) i;

insert into products (id, machine_id, kind, brand, model, serial_number, part_number, status, issues, location_id, location,
                      created_at, updated_at)
select 'prod-bulk-' || i, 'BULK-' || i, 'Laptop', 'Marca ' || (i % 7), 'Modelo ' || (i % 31), 'SN-BULK-' || i, 'PN-' || (i % 97),
       case when i % 20 < 12 then 'available' when i % 20 < 17 then 'in_use' when i % 20 < 19 then 'in_repair' else 'retired' end,
       null, l.id, l.name,
       pg_temp.iso(now() at time zone 'utc'), pg_temp.iso(now() at time zone 'utc')
from generate_series(1, 3000) i
join (select id, name, row_number() over (order by id) - 1 as n from locations) l on l.n = i % (select count(*) from locations);

insert into tickets (id, title, description, category, status, submitted_by_id, assigned_to_id, equipment_id, diagnosis, corrected,
                     actions_taken, created_at, updated_at, resolved_at, attended_at, rating, rated_at)
select 'tk-bulk-' || i, 'Ticket ' || i, 'Descripción generada para medir rendimiento ' || i,
       (array['hardware', 'software', 'network', 'other'])[1 + (i % 4)], b.st,
       'u-bulk-' || (1 + (i % 2000)),
       case when b.st = 'pending' then null else 'u-tec-' || (1 + (i % 3)) end,
       'prod-bulk-' || (1 + (i % 3000)),
       case when b.st = 'resolved' then 'Diagnóstico ' || i end,
       case when b.st = 'resolved' then true end,
       case when b.st = 'resolved' then 'Acciones ' || i end,
       pg_temp.iso(b.created), pg_temp.iso(b.created + interval '5 hours'),
       case when b.st = 'resolved' then pg_temp.iso(b.created + interval '5 hours') end,
       case when b.st <> 'pending' then pg_temp.iso(b.created + interval '1 hour') end,
       case when b.st = 'resolved' and i % 2 = 0 then 1 + (i % 5) end,
       case when b.st = 'resolved' and i % 2 = 0 then pg_temp.iso(b.created + interval '6 hours') end
from (
  select i,
         case when i % 20 < 15 then 'resolved' when i % 20 < 17 then 'pending' when i % 20 < 19 then 'in_progress' else 'in_resolution' end as st,
         (now() at time zone 'utc') - (i % 365) * interval '1 day' - (i % 24) * interval '1 hour' as created
  from generate_series(1, 20000) i
) b;

insert into loans (id, equipment_id, user_id, status, approved_by_id, delivered_by_id, delivered_at, issue_date, return_date,
                   actual_return_date, created_at, updated_at)
select 'ln-bulk-' || i,
       case when b.st = 'returned' then 'prod-bulk-' || (1 + (i % 3000)) else 'prod-bulk-' || (2000 + (i % 1000)) end,
       'u-bulk-' || (1 + (i % 2000)), b.st,
       case when b.st <> 'pending' then 'u-tec-1' end,
       case when b.st <> 'pending' then 'u-tec-1' end,
       case when b.st <> 'pending' then pg_temp.iso(b.issued) end,
       pg_temp.iso(b.issued),
       case when b.st = 'returned' then pg_temp.iso(b.issued + interval '3 days') else pg_temp.iso((now() at time zone 'utc') + interval '30 days') end,
       case when b.st = 'returned' then pg_temp.iso(b.issued + interval '2 days') end,
       pg_temp.iso(b.issued), pg_temp.iso(b.issued)
from (
  select i,
         case when i <= 100 then 'pending' when i <= 300 then 'active' else 'returned' end as st,
         (now() at time zone 'utc') - (i % 365) * interval '1 day' - interval '10 days' as issued
  from generate_series(1, 10000) i
) b;

insert into service_requests (id, type, status, requested_by_id, assigned_to_id, description, equipment_id, created_at, updated_at)
select 'sr-bulk-' || i,
       (array['lab_preparation', 'software_installation', 'equipment_setup', 'other'])[1 + (i % 4)],
       case when i % 10 < 7 then 'completed' when i % 10 < 8 then 'pending' when i % 10 < 9 then 'in_progress' else 'rejected' end,
       'u-bulk-' || (1 + (i % 2000)),
       case when i % 10 >= 8 or i % 10 < 7 then 'u-tec-' || (1 + (i % 3)) end,
       'Solicitud ' || i, null,
       pg_temp.iso((now() at time zone 'utc') - (i % 120) * interval '1 day'),
       pg_temp.iso((now() at time zone 'utc') - (i % 120) * interval '1 day')
from generate_series(1, 10000) i;

insert into comments (id, entity_type, entity_id, author_id, body, created_at)
select 'cm-bulk-' || i, 'ticket', 'tk-bulk-' || (1 + (i % 20000)), 'u-tec-1', 'Comentario ' || i,
       pg_temp.iso((now() at time zone 'utc') - (i % 300) * interval '1 day')
from generate_series(1, 5000) i;

commit;

analyze;

-- Para quitar estos datos:
--   delete from comments where id like 'cm-bulk-%';
--   delete from service_requests where id like 'sr-bulk-%';
--   delete from loans where id like 'ln-bulk-%';
--   delete from tickets where id like 'tk-bulk-%';
--   delete from products where id like 'prod-bulk-%';
--   delete from users where id like 'u-bulk-%';

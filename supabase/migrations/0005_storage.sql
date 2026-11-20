-- Public bucket for failure screenshots. Uploads happen only from the worker
-- (service_role); the bucket is public-read so Discord/email can embed images.
-- Object paths are unguessable: <check_id>/<run idempotency hash>/<step>.png
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', true, 5242880, array['image/png'])
on conflict (id) do nothing;

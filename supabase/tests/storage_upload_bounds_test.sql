begin;
select plan(8);

select ok(file_size_limit > 0 and file_size_limit <= 5242880,
  'cat photos enforce a server upload ceiling of 5 MiB')
from storage.buckets where id = 'cat-photos';
select ok(file_size_limit > 0 and file_size_limit <= 5242880,
  'avatars enforce a server upload ceiling of 5 MiB')
from storage.buckets where id = 'avatars';
select ok(file_size_limit > 0 and file_size_limit <= 10485760,
  'ID photos enforce a server upload ceiling of 10 MiB')
from storage.buckets where id = 'screening-docs';

select is(allowed_mime_types, array['image/jpeg','image/png','image/webp']::text[],
  'cat photos accept only declared supported image types')
from storage.buckets where id = 'cat-photos';
select is(allowed_mime_types, array['image/jpeg','image/png','image/webp']::text[],
  'avatars reject declared active-document and arbitrary-file types')
from storage.buckets where id = 'avatars';
select is(allowed_mime_types,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[],
  'ID photos retain original iOS camera types but reject active documents')
from storage.buckets where id = 'screening-docs';
select ok(not public, 'ID photo bucket remains private')
from storage.buckets where id = 'screening-docs';
select is((select count(*)::int from storage.buckets
  where id in ('avatars','cat-photos') and public), 2,
  'existing public avatar and cat-photo behavior is preserved');

select * from finish();
rollback;

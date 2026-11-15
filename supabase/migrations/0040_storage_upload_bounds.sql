-- Server-side upload bounds cannot be bypassed by skipping app validation.
-- Storage enforces these limits on new uploads, including direct API calls.
-- Existing objects remain intact. This does not replace aggregate storage
-- usage alerts, owner quotas, or photo-content moderation.
-- Apply only after hosted schema/history inspection and staging rehearsal.
update storage.buckets
set file_size_limit = least(coalesce(file_size_limit, 5242880), 5242880),
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('avatars', 'cat-photos');

-- ID photos currently retain the camera's original encoding. Keep HEIC/HEIF
-- compatible with iOS while rejecting active documents such as SVG or HTML.
update storage.buckets
set public = false,
    file_size_limit = least(coalesce(file_size_limit, 10485760), 10485760),
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id = 'screening-docs';

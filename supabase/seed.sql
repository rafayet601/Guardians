-- ============================================================================
-- Guardians — optional demo seed
-- A handful of unowned sightings so the map isn't empty before real users
-- start reporting. Centered on San Francisco; edit the coordinates to taste.
-- Run AFTER the migrations:  (Supabase SQL editor or `supabase db reset`)
-- ============================================================================

insert into public.sightings
  (reporter_id, title, description, location, status, temperament, color, is_injured, needs_urgent_help)
values
  (null, 'Orange tabby near Dolores Park',
   'Friendly orange tabby hanging around the tennis courts. Comes when called.',
   st_setsrid(st_makepoint(-122.4271, 37.7596), 4326)::geography,
   'spotted', 'friendly', 'orange', false, false),

  (null, 'Skittish black kitten',
   'Small black kitten under a parked car on Valencia St. Very shy.',
   st_setsrid(st_makepoint(-122.4214, 37.7641), 4326)::geography,
   'spotted', 'shy', 'black', false, true),

  (null, 'Injured grey cat',
   'Grey cat limping near the Ferry Building. Looks like a hurt paw.',
   st_setsrid(st_makepoint(-122.3937, 37.7955), 4326)::geography,
   'spotted', 'unknown', 'grey', true, true),

  (null, 'Calico ready for adoption',
   'Sweet calico, vetted and spayed, looking for a forever home.',
   st_setsrid(st_makepoint(-122.4477, 37.7699), 4326)::geography,
   'available', 'friendly', 'calico', false, false),

  (null, 'Tuxedo cat colony',
   'Two tuxedo cats living behind the cafe. Being fed by neighbors.',
   st_setsrid(st_makepoint(-122.4099, 37.7835), 4326)::geography,
   'spotted', 'feral', 'tuxedo', false, false);

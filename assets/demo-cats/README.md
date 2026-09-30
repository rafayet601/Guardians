# Demo cat sighting photos

Five AI-generated demo images, created with the built-in ImageGen tool. Bundled as 1200 × 800 JPEGs for offline use on native and reliable loading on web.

Used by the feed, nearby list, and sighting detail screen. Only unowned records matching the five explicit IDs in `supabase/seed.sql` receive these images. These IDs were verified against the existing demo records (including their descriptions, colors, temperaments, and coordinates); future seeds use the same IDs. Real uploaded images take priority. Each demo image is labeled “Demo photo” and identified as AI-generated in its accessibility label. No database changes or photo uploads are needed for those existing records. Older seeds in other databases with random IDs must be explicitly verified and added to the registry; matching a title or having a deleted reporter never grants a demo photo.

## Generation prompts

Each image was generated separately with this complete template:

> Use case: photorealistic-natural. Asset type: demo cat-sighting photograph for Guardians app. Primary request: [scene below] Style: realistic candid neighborhood rescue volunteer photograph, natural fur texture, believable anatomy and surroundings, soft daylight, restrained depth of field, no stylization. Landscape 3:2 composition, cat faces near center and fully within the central 50 percent for both narrow portrait thumbnail and wide hero crops. Show the whole cat with breathing room. No text, no logos, no watermark, no collage.

- `orange-tabby.jpg`: A friendly adult orange tabby sitting on a worn path beside grass and tennis-court fencing in a San Francisco neighborhood park.
- `black-kitten.jpg`: A small shy black kitten crouching near the wheel of a safely parked car on a quiet neighborhood sidewalk, face fully visible and naturally lit.
- `grey-cat.jpg`: An adult short-haired grey cat resting on waterfront paving beside an old brick building. All paws naturally resting, no visible injuries or blood.
- `calico.jpg`: A friendly adult calico cat with white, orange and black patches sitting on a soft cream blanket near a sunlit window in a foster home.
- `tuxedo.jpg`: Two black-and-white tuxedo cats sitting close together beside planters on a quiet cafe back patio.

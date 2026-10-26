# Brief: Daily Brief post images — Download gets the generated image; pick 1–4 images

Owner request (2026-10-26): "I generate a new visual for this post but when I click download, it downloads the old default image, not the newly generated one, check, correct and push the fix. Also change the image size selection, instead of 1-3, 3-5, it should just be a check box for 1,2,3 or 4."

## Problem
- Generated images are stored in the bucket (`S3_PUBLIC_URL`, another origin). The post shows them with `<img>`, which needs no CORS. Download (`visualBlob`) reads them with `fetch(url)`, which does. The bucket sends no CORS headers, so the fetch throws, and `visualBlob` silently falls back to drawing the style's brand template in the browser. That is the "old default image".
- The same `visualBlob` serves Social packs and the article image download, so they have the same bug.
- "Number of images" offers ranges (1–3 recommended, 3–5) and Radar picks the exact count.

## Acceptance criteria
- PID-1: Download on a Daily Brief post saves the stored generated image(s), byte for byte, when they live in the bucket (cross-origin) or on local disk.
- PID-2: Bucket images are read through a same-origin route that requires a signed-in member (Viewer+) of the business. It serves only Radar-stored files of that business (`/api/files/<bid>/…` or `<S3_PUBLIC_URL>/<bid>/…`); other hosts, other businesses and `..` paths get 404.
- PID-3: When a stored image can't be read, Download shows an error toast and saves nothing. It never substitutes the template. Posts without a stored image still download the template render, as before.
- PID-4: Social pack and article image downloads use the same path (PID-1 and PID-3).
- PID-5: The Add visuals window shows "Number of images" as a single choice of 1, 2, 3 or 4. Create images makes exactly that many, and the post shows that many.
- PID-6: The window opens with the post's current count, or the business's last choice (`social.img`). Saved settings and posts from before map: 1–3 → 1, 3–5 → 3. Old posts with 5 images open as 4.
- PID-7: "Try again" after a failure keeps the post's count.

## Decisions
- The count is a single choice, shown with the existing segmented control (1 | 2 | 3 | 4), not multi-select checkboxes.
- Hint text: "X allows up to 4." ("Radar picks the exact number" is no longer true.)
- No bucket CORS change. The fix works without infrastructure changes.

## Delivery
PR to `main` from `kenny-dev/post-image-download-size-5ca656`. Merging deploys to Railway production and needs the owner's go-ahead.

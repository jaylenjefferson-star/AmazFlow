# Hosting configuration — deep-link rewrites for the three surfaces

Task 9.9, requirements 1.6 and 1.7. Remediates **Risk R-4**.

## Why these files exist

All three surfaces are static exports (requirement 1.4). There is no frontend server on any of the
three origins, so a request for `/runs/run_123/` does not reach any code that knows what a run is —
it reaches a file lookup that finds nothing.

Every deep link therefore depends on one rewrite rule per surface: *serve the shell for anything that
is not a real file, and let the shell resolve the path against its route table.* Without it a hard
reload, a pasted link, or a link in an email answers 404, and requirement 16.16's shareable run link
is not shareable.

Until now that rule existed **only as hosting-console state**. It was configured by hand, in a web
console, with no record in the repository, no review, and no way to notice it had been changed or
lost. Rebuilding the hosting app — or creating the two new ones — would have silently dropped every
deep link on the floor. That is Risk R-4, and these files are what closes it: the rules are now
version-controlled infrastructure that a reviewer can read and a diff can catch.

## Applying them

The JSON in each file is the `customRules` array the hosting provider's rewrite configuration takes,
in its own format. Applying them is a deliberate step rather than something the build does, because
a rewrite rule that is wrong takes a surface down and should not be able to arrive as a side effect
of a code push:

```
aws amplify update-app --app-id <app-id> \
  --custom-rules "$(cat infrastructure/hosting/<origin>.json)"
```

The three app ids are per-environment and belong in the environment's own record, not here.

## The rules, and why each surface's differs

| Origin | File | Shape |
| --- | --- | --- |
| `amazflow.com` | [`amazflow.com.json`](amazflow.com.json) | Per-section SPA rewrites for `/app` and `/console`; marketing pages are real exported files and must keep 404ing when they do not exist |
| `app.amazflow.com` | [`app.amazflow.com.json`](app.amazflow.com.json) | One catch-all to `/index.html`; the whole origin is one application |
| `admin.amazflow.com` | [`admin.amazflow.com.json`](admin.amazflow.com.json) | Same catch-all shape as the customer app |

The marketing origin is the one that cannot take a blanket catch-all. `amazflow.com` serves real
exported pages — `/pricing/`, `/security/`, `/legal/` — and a catch-all there would answer 200 with
the marketing home page for every mistyped URL and every dead link, which destroys the 404 signal
that link checkers, search engines, and support tickets all depend on. So its rules name the two
application prefixes (`/app`, `/console`) and leave the rest alone. Those two stay live until the
task 28.4 cutover (requirement 1.11).

## The exclusion pattern

Each SPA rule excludes paths that look like files:

```
</^[^.]+$|\.(?!(?:css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|avif)$)([^.]+$)/>
```

Read it as: *rewrite anything with no dot in it, and anything whose extension is not one of the
listed static asset types.* Without the exclusion the rewrite swallows the bundle's own requests —
`/_next/static/chunks/main.js` would be served `index.html`, and the surface would render a blank page
while the network tab showed 200s for everything. `.map` and `.json` are on the list because a
sourcemap or `manifest.json` served as HTML is the same failure in a quieter form.

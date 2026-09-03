# Collection Cataloguing Workflow

How to catalogue and digitize a physical disc/tape collection using this
repo's web app together with the companion
[media-manager-mobile](https://github.com/colinmarley/media-manager-mobile)
app and [disc-ripper-service](https://github.com/colinmarley/disc-ripper-service).
This is the cross-app walkthrough — each app's own README/docs cover its
individual screens in more detail.

Written for the common situation this system is actually used for: a large
existing collection (hundreds to low thousands of discs, a smaller batch of
tapes) that needs to be catalogued and ripped over many separate sessions,
not all at once.

---

## The four steps

### 1. Catalogue from your phone while sorting

You don't need to be at the ripping PC to log a disc or tape into the
catalog. Open **media-manager-mobile**, connect to this backend over
Tailscale, and use the **Add** tab:

- Scan or type the barcode, pick format/condition/region/edition from the
  chip lists, snap a cover photo.
- Assign a **storage location** — a type (Box or Binder) and an ID you make
  up (e.g. `MED0001`) — so you can find the physical item again later. This
  is independent of which movie/show it contains; it's purely "where does
  this thing live."
- For a disc with more than one title on it (a double-feature, a boxed set
  disc), link it to every title, or attach it to a boxed set.

This creates the `Disc`/`Tape` catalog row — it does **not** require the
item to have been ripped yet, and it works from anywhere on your tailnet.

### 2. Rip it later, at the machine with the drive

Ripping only happens from this web app, at `/admin/disc-ripper` (discs) or
`/admin/tape-ingest` (tapes), and only on the machine physically hosting the
optical drive / capture hardware (see `disc-ripper-service`'s own setup
docs — it's not portable to another machine).

When you configure a disc rip, the **"Link to catalog disc"** panel lets you
search for and attach the pre-catalogued `Disc` record you made from your
phone in step 1 — by title or barcode. **This step is optional and easy to
skip under load — skipping it means the rip completes normally, but nothing
ties the resulting files back to that disc's catalog row**, which matters
for step 3 below. If you don't have (or can't find) a pre-existing catalog
entry, you can also create one on the spot from this screen.

Once ripped, files are delivered to the shared ingest folder and matched to
a Movie/Series catalog entry automatically (by filename/IMDb-ID confidence
scoring) or queued for manual review at `/admin` → Ingress Automation.

### 3. Check what's still unripped

There's no dedicated "unripped discs" dashboard yet (tracked as a gap — see
below). Today, the way to check is per-item: open the disc/tape's detail
page (`/dashboard/physical-media/{type}/{id}`) and look at **Connected
Files** — if it's empty, that physical item hasn't been ripped and linked
yet. `GET /api/catalog/discs` also returns a `linkedFileCount` field per
disc if you want to script a check against it.

### 4. Find a disc physically, later

Once storage locations are assigned (step 1), open the mobile app's **Beta**
tab — Shelf view groups items by box, Binder view pages through binders
4-at-a-time — to see where a given disc actually is on your shelf.

---

## Known gaps in this loop

- No disc/tape-level "still needs ripping" list or filter in either app —
  today's `linkedFileCount` field (added to `GET /api/catalog/discs`) makes
  this scriptable but not yet visible in the UI.
- Linking a rip to its pre-catalogued disc (step 2) is opt-in per rip, not
  enforced or defaulted from a barcode scan at the ripper.
- No reverse lookup from a Movie/Series detail page back to which
  disc(s) it's on and where they're stored.

These (and others) are tracked outside this doc — ask for the current
capability gap-list if you're planning what to build next.

# Xiaohongshu Live Photo Library2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload normal images to Library2 with a maximum concurrency of four, and save every Xiaohongshu Live Photo as an ordered static-cover/MP4 pair that can be previewed, deleted, and safely reused for static image fission.

**Architecture:** Keep `Library2Item.images` as the canonical ordered static-image list and add an optional `livePhotos` association list keyed by `coverFileId`. The extension walks the active Xiaohongshu carousel, resolves each active slide's cover and video source, uploads normal images four at a time, uploads MP4 files sequentially, then commits one manifest only after the server validates every stored object. Existing image fission continues to consume only `images`; the Library2 UI uses `livePhotos` solely for the LIVE badge and video playback.

**Tech Stack:** Chrome/Edge Manifest V3 extension, JavaScript UMD helpers, Next.js 15 route handlers, TypeScript, Tencent COS through `ContentStorageGateway`, React 19, Node test runner via `tsx --test`, PowerShell extension packager.

---

## File structure

- `browser-extension/shared/library2-upload.js`: bounded-concurrency upload helper shared by service-worker logic and unit tests.
- `browser-extension/shared/library2-live.js`: Xiaohongshu Live carousel traversal, cover/video pairing, resource-timing resolution, and content-side blob streaming.
- `browser-extension/shared/library2-media.js`: official-host download validation for images and MP4, including `ftyp` sniffing and size limits.
- `browser-extension/shared/page-extract.js`: mark Xiaohongshu Live details without changing the static `imageUrls` contract.
- `browser-extension/library2-bar.js`: show Live recognition status, collect pairs on click, and serve requested `blob:` video chunks over a runtime port.
- `browser-extension/background.js`: orchestrate four-way image upload, sequential Live video download/upload, and the final atomic commit.
- `lib/content-library-2/contracts.ts`: backward-compatible `livePhotos` types, Live descriptor parsing, IDs, COS keys, and limits.
- `lib/content-library-2/upload-capability.ts`: signed capability union for image and Live upload targets.
- `lib/content-library-2/service.ts`: issue image/Live upload plans, validate stored pairs, expose video media, and delete paired objects.
- `app/api/library2/upload-intents/route.ts`: accept image descriptors plus Live descriptors.
- `app/api/library2/items/[contentId]/commit/route.ts`: accept both returned upload lists.
- `app/api/library2/items/[contentId]/live/[fileId]/upload/route.ts`: stream-validate and store one MP4 object.
- `app/content-library-2/page.tsx`: render LIVE badges and play the paired video with the static cover as poster.
- `lib/content-library-2/generation.ts`: intentionally unchanged in behavior; regression tests prove it ignores MP4 associations.
- `tests/fixtures/xhs-live-detail.html`: deterministic three-slide Live fixture with Swiper duplicates and blob URLs.
- `tests/library2-upload.test.ts`: exact concurrency, order, and indexed-error tests.
- `tests/library2-live.test.ts`: carousel pairing, deduplication, restore, remote-resource, and blob-stream tests.
- `tests/library2-page-extract.test.ts`: Live detection and unchanged normal-XHS extraction tests.
- `tests/content-library-2-service.test.ts`: COS keys, atomic commit, account isolation, paired deletion, and old-manifest compatibility.
- `tests/content-library-2-routes.test.ts`: authenticated MP4 upload/retrieval and invalid/oversized payload cases.
- `tests/content-library-2-generation.test.ts`: static-cover-only fission regression.
- `tests/content-library-2-contract.test.ts`: UI LIVE preview/delete contract.
- `browser-extension/manifest.template.json`, `扩展/manifest.json`, `scripts/package-xhs-extension.ps1`, `app/api/extension/download/route.ts`, and extension download tests: publish version `0.1.33` containing the new helper.

### Task 1: Bounded four-way image uploads

**Files:**
- Create: `browser-extension/shared/library2-upload.js`
- Modify: `browser-extension/background.js`
- Test: `tests/library2-upload.test.ts`

- [ ] **Step 1: Write the failing bounded-concurrency tests**

Create tests that call a real exported helper and hold worker promises open long enough to measure the peak:

```ts
test("runs at most four uploads and returns results in input order", async () => {
  let active = 0;
  let peak = 0;
  const gates = Array.from({ length: 7 }, () => Promise.withResolvers<void>());
  const started: number[] = [];
  const pending = upload.runBounded(
    Array.from({ length: 7 }, (_, index) => index),
    4,
    async (value, index) => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(index);
      await gates[index]!.promise;
      active -= 1;
      return value * 10;
    }
  );
  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2, 3]);
  gates[1]!.resolve();
  await Promise.resolve();
  assert.equal(started.includes(4), true);
  gates.forEach((gate) => gate.resolve());
  assert.deepEqual(await pending, [0, 10, 20, 30, 40, 50, 60]);
  assert.equal(peak, 4);
});

test("reports the original one-based index when an upload fails", async () => {
  await assert.rejects(
    upload.uploadLibraryImages(["a", "b", "c"], async (_value, index) => {
      if (index === 1) return new Response(null, { status: 502 });
      return new Response(null, { status: 200 });
    }),
    /第 2 张图片上传失败/
  );
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `npx.cmd tsx --test tests/library2-upload.test.ts`

Expected: FAIL because `browser-extension/shared/library2-upload.js` does not exist.

- [ ] **Step 3: Implement the minimum bounded helper**

Use a fixed worker pool and an indexed result array:

```js
async function runBounded(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
  return results;
}

async function uploadLibraryImages(uploads, put) {
  return runBounded(uploads, 4, async (upload, index) => {
    const response = await put(upload, index);
    if (!response.ok) throw new Error(`第 ${index + 1} 张图片上传失败`);
    return true;
  });
}
```

Load the helper in `background.js` and replace only the serial image PUT loop. Keep the later commit payload in original `intent.uploads` order.

- [ ] **Step 4: Run the focused tests**

Run: `npx.cmd tsx --test tests/library2-upload.test.ts tests/library2-page-extract.test.ts`

Expected: PASS; peak concurrency is exactly four and the existing extension contract stays green.

- [ ] **Step 5: Commit the concurrency slice**

```powershell
git add -- browser-extension/shared/library2-upload.js browser-extension/background.js tests/library2-upload.test.ts tests/library2-page-extract.test.ts
git commit -m "perf: upload library images four at a time"
```

### Task 2: Detect and pair every Live carousel slide

**Files:**
- Create: `browser-extension/shared/library2-live.js`
- Create: `tests/fixtures/xhs-live-detail.html`
- Create: `tests/library2-live.test.ts`
- Modify: `browser-extension/shared/page-extract.js`
- Modify: `browser-extension/library2-bar.js`
- Modify: `browser-extension/manifest.template.json`
- Test: `tests/library2-page-extract.test.ts`

- [ ] **Step 1: Add a realistic three-slide fixture and failing tests**

The fixture must contain three logical `data-swiper-slide-index` values, one duplicate slide, `.live-photo-contain`, `.live-img`, `.live-video`, next/previous buttons, and `1/3`. The test simulates each next click by changing the active class and provides resource entries such as:

```ts
const resources = [
  { name: "https://sns-video-v3.xhscdn.com/live-1.mp4?sign=1", initiatorType: "video", startTime: 1 },
  { name: "https://sns-video-v3.xhscdn.com/live-2.mp4?sign=2", initiatorType: "video", startTime: 2 },
  { name: "https://sns-video-v3.xhscdn.com/live-3.mp4?sign=3", initiatorType: "video", startTime: 3 }
];
const pairs = await live.collectXhsLivePhotos(document, {
  performance: { getEntriesByType: () => resources },
  delay: async () => {},
  maxWaitMs: 20
});
assert.deepEqual(pairs.map((pair) => [pair.order, pair.coverUrl, pair.videoSource.kind]), [
  [0, "https://sns-webpic-qc.xhscdn.com/live-1.jpg", "remote"],
  [1, "https://sns-webpic-qc.xhscdn.com/live-2.jpg", "remote"],
  [2, "https://sns-webpic-qc.xhscdn.com/live-3.jpg", "remote"]
]);
assert.equal(activeIndex(document), "0");
```

Add separate cases proving a duplicate slide is ignored, a `blob:` source is returned only when no matching official MP4 resource is available, and one missing video rejects with `第 2 张 Live 图片没有对应视频`.

- [ ] **Step 2: Run Live/extractor tests and verify failure**

Run: `npx.cmd tsx --test tests/library2-live.test.ts tests/library2-page-extract.test.ts`

Expected: FAIL because the Live helper and `isLive` extraction flag do not exist.

- [ ] **Step 3: Implement carousel collection**

Expose the focused API:

```js
async function collectXhsLivePhotos(document, options = {}) {
  const scope = findVisibleLiveRoot(document);
  const logicalIndexes = uniqueLogicalIndexes(scope);
  const originalIndex = activeLogicalIndex(scope);
  const usedVideos = new Set();
  const pairs = [];
  for (let order = 0; order < logicalIndexes.length; order += 1) {
    await waitForActiveIndex(scope, logicalIndexes[order], options);
    const coverUrl = activeCoverUrl(scope);
    const videoSource = resolveActiveVideoSource(scope, options.performance, usedVideos);
    if (!coverUrl || !videoSource) throw new Error(`第 ${order + 1} 张 Live 图片没有对应视频`);
    pairs.push({ order, coverUrl, videoSource });
    if (order + 1 < logicalIndexes.length) clickNext(scope);
  }
  await restoreActiveIndex(scope, originalIndex, options);
  return pairs;
}
```

Resolve an active HTTPS `video.currentSrc`/`src` first, otherwise choose the newest unused official `xhscdn.com` MP4 resource entry for the active slide, otherwise keep the active `blob:` URL for the chunked fallback. Always restore the original slide in `finally`.

Update `extractXhs` to return `isLive: true` when the visible detail contains `.live-photo-contain`, `.live-video`, or a visible `LIVE` marker, while preserving the existing ordered `imageUrls`. `library2-bar.js` calls `collectXhsLivePhotos` only after the user clicks upload and replaces `imageUrls` with the ordered `coverUrl` values.

- [ ] **Step 4: Register the helper and render accurate status**

Load `shared/library2-live.js` before `library2-bar.js`. Status examples must be deterministic:

```js
setStatus(note.isLive
  ? `${note.platform} · ${count} 组 Live · 已识别文案`
  : `${note.platform} · ${count} 张图${note.body ? " · 已识别文案" : ""}`, "info");
```

During collection show `正在逐组读取小红书 Live…`; do not claim success until background commit succeeds.

- [ ] **Step 5: Run the Live extraction tests**

Run: `npx.cmd tsx --test tests/library2-live.test.ts tests/library2-page-extract.test.ts`

Expected: PASS for three ordered pairs, duplicate removal, missing-pair rejection, and ordinary Xiaohongshu/Douyin/TikTok extraction.

- [ ] **Step 6: Commit the carousel slice**

```powershell
git add -- browser-extension/shared/library2-live.js browser-extension/shared/page-extract.js browser-extension/library2-bar.js browser-extension/manifest.template.json tests/fixtures/xhs-live-detail.html tests/library2-live.test.ts tests/library2-page-extract.test.ts
git commit -m "feat: collect Xiaohongshu Live photo pairs"
```

### Task 3: Validate and stream Live MP4 bytes in the extension

**Files:**
- Modify: `browser-extension/shared/library2-media.js`
- Modify: `browser-extension/shared/library2-live.js`
- Modify: `browser-extension/library2-bar.js`
- Modify: `browser-extension/background.js`
- Test: `tests/library2-live.test.ts`
- Test: `tests/library2-page-extract.test.ts`

- [ ] **Step 1: Write failing MP4 and blob-port tests**

Test both MIME and signature validation:

```ts
const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
assert.equal(media.sniffVideoType(mp4), "video/mp4");
assert.equal(media.sniffVideoType(new Uint8Array(12)), "");
assert.deepEqual(await media.downloadVideo(url, okFetch), {
  bytes: mp4,
  contentType: "video/mp4",
  size: mp4.byteLength
});
await assert.rejects(media.downloadVideo(url, htmlFetch), /Live 视频格式无效/);
```

Test that `streamBlob(port, blobUrl)` emits `start`, bounded ordered chunks, and `complete`; a failed `fetch(blobUrl)` emits `error` and never emits `complete`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx.cmd tsx --test tests/library2-live.test.ts tests/library2-page-extract.test.ts`

Expected: FAIL because MP4 validation and blob-port helpers are not implemented.

- [ ] **Step 3: Add MP4 download validation**

Add constants `LIVE_VIDEO_MAX_BYTES = 100 * 1024 * 1024` and `LIVE_VIDEO_TOTAL_MAX_BYTES = 500 * 1024 * 1024`. `downloadVideo` must enforce the official HTTPS allowlist, a 30-second timeout, a response size limit while reading, normalized `video/mp4` header, and an MP4 `ftyp` box within the first 32 bytes:

```js
function sniffVideoType(bytes) {
  if (!bytes || bytes.length < 12) return "";
  for (let offset = 4; offset <= Math.min(bytes.length - 8, 28); offset += 1) {
    if (bytes[offset] === 0x66 && bytes[offset + 1] === 0x74
      && bytes[offset + 2] === 0x79 && bytes[offset + 3] === 0x70) return "video/mp4";
  }
  return "";
}
```

- [ ] **Step 4: Add the content-to-service-worker blob fallback**

Use a named `chrome.runtime` port so the MV3 worker stays alive. The background requests one blob at a time, `library2-bar.js` fetches that exact page `blob:` URL, and `library2-live.js` sends 192 KiB base64 chunks. The background verifies consecutive chunk indexes, total bytes, the 100 MB limit, and `ftyp`, then immediately uploads and releases that byte array before requesting the next video. Reject unknown port messages and clear buffers on disconnect.

- [ ] **Step 5: Run extension media tests**

Run: `npx.cmd tsx --test tests/library2-live.test.ts tests/library2-page-extract.test.ts tests/xhs-media-transfer.test.ts`

Expected: PASS; existing XHS media transfer behavior is unchanged.

- [ ] **Step 6: Commit the validated transfer slice**

```powershell
git add -- browser-extension/shared/library2-media.js browser-extension/shared/library2-live.js browser-extension/library2-bar.js browser-extension/background.js tests/library2-live.test.ts tests/library2-page-extract.test.ts
git commit -m "feat: transfer validated Live MP4 media"
```

### Task 4: Add backward-compatible Live contracts and upload plans

**Files:**
- Modify: `lib/content-library-2/contracts.ts`
- Modify: `lib/content-library-2/upload-capability.ts`
- Modify: `lib/content-library-2/service.ts`
- Modify: `app/api/library2/upload-intents/route.ts`
- Test: `tests/content-library-2-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create an intent for two images and two Live descriptors and assert ordered associations:

```ts
const intent = await createLibrary2UploadIntent("member-a", {
  images: [jpeg, jpeg],
  livePhotos: [
    { order: 0, coverIndex: 0, contentType: "video/mp4", size: 12 },
    { order: 1, coverIndex: 1, contentType: "video/mp4", size: 14 }
  ]
}, gateway, deterministicOptions);
assert.equal(intent.liveUploads[0]!.coverFileId, intent.uploads[0]!.fileId);
assert.match(intent.liveUploads[0]!.key, /\/library2\/.*\/live\/001-[0-9a-f]{12}\.mp4$/);
```

Add rejection tests for duplicate `order`, duplicate `coverIndex`, missing cover, non-MP4 MIME, >100 MB per file, >500 MB total, and more Live descriptors than images. Add an old `schemaVersion: 1` manifest without `livePhotos` and prove it still lists/loads.

- [ ] **Step 2: Run service tests and verify failure**

Run: `npx.cmd tsx --test tests/content-library-2-service.test.ts`

Expected: FAIL because Live descriptors, IDs, keys, and upload plans do not exist.

- [ ] **Step 3: Add the data contract**

Define:

```ts
export interface Library2LivePhoto {
  order: number;
  coverFileId: string;
  videoFileId: string;
  key: string;
  contentType: "video/mp4";
  size: number;
}

export interface Library2Item {
  // existing fields remain unchanged
  livePhotos?: Library2LivePhoto[];
}
```

Add `Library2LiveDescriptor`, `Library2LiveUploadObject`, `library2LiveKey`, `createLibrary2LiveFileId`, `validateLibrary2LiveFileId`, and strict `parseLibrary2LiveDescriptors`. Keep `schemaVersion: 1` because the new field is optional and old manifests require no migration.

- [ ] **Step 4: Sign separate image/Live capabilities**

Extend the signed payload with `mediaKind: "image" | "live"`. Image verification still calls `parseImageDescriptors`; Live verification accepts only `video/mp4` and the server limits. The signature continues to bind payload, `contentId`, and `fileId`.

- [ ] **Step 5: Issue paired upload plans**

`createLibrary2UploadIntent` parses `{ images, livePhotos }`, creates image objects first, and then creates Live objects whose `coverFileId` is taken only from `objects[coverIndex]`. Return:

```ts
{
  contentId,
  uploads: imageObjectsWithUploadUrls,
  liveUploads: liveObjectsWithUploadUrls
}
```

The Live upload URL is `/api/library2/items/<contentId>/live/<videoFileId>/upload?token=...`.

- [ ] **Step 6: Run service tests**

Run: `npx.cmd tsx --test tests/content-library-2-service.test.ts tests/content-library-2-routes.test.ts`

Expected: service tests PASS and pre-existing image-only route tests remain PASS.

- [ ] **Step 7: Commit the contract slice**

```powershell
git add -- lib/content-library-2/contracts.ts lib/content-library-2/upload-capability.ts lib/content-library-2/service.ts app/api/library2/upload-intents/route.ts tests/content-library-2-service.test.ts
git commit -m "feat: plan paired Live media uploads"
```

### Task 5: Store, commit, serve, and delete Live videos atomically

**Files:**
- Create: `app/api/library2/items/[contentId]/live/[fileId]/upload/route.ts`
- Modify: `app/api/library2/items/[contentId]/commit/route.ts`
- Modify: `lib/content-library-2/service.ts`
- Modify: `app/api/library2/items/[contentId]/media/[fileId]/route.ts`
- Test: `tests/content-library-2-routes.test.ts`
- Test: `tests/content-library-2-service.test.ts`

- [ ] **Step 1: Add failing route and atomicity tests**

Upload valid MP4 bytes with `Content-Type: video/mp4`, commit both lists, then retrieve through the existing media GET endpoint. Assert another member gets 404. Add invalid cases for an HTML body, missing `ftyp`, declared-size mismatch, oversized `Content-Length`, a missing Live object at commit, and a Live association whose `coverFileId` is not in the image list.

Also verify no manifest exists after a failed commit:

```ts
await assert.rejects(
  () => commitLibrary2Item("member-a", intent.contentId, draft, intent.uploads, intent.liveUploads, gateway),
  /第 2 个 Live 视频尚未上传/
);
assert.equal(await gateway.getJson(library2ManifestKey("member-a", intent.contentId)), undefined);
```

- [ ] **Step 2: Run route/service tests and verify failure**

Run: `npx.cmd tsx --test tests/content-library-2-routes.test.ts tests/content-library-2-service.test.ts`

Expected: FAIL because the Live PUT route and commit validation are missing.

- [ ] **Step 3: Implement the streaming Live upload route**

Mirror the current image upload route's bounded reader, but use the signed Live descriptor, a 100 MB limit, `video/mp4`, `.mp4`, and `ftyp`. Never call `putObject` until the complete declared body has passed all checks.

- [ ] **Step 4: Validate all objects before writing the manifest**

Change the service signature to:

```ts
commitLibrary2Item(ownerId, contentId, draftInput, imageFiles, liveFiles, gateway, now?)
```

Resolve all image heads and all Live heads first. Build `livePhotos` from server-issued `order`, `coverFileId`, and `videoFileId`; reject duplicates or dangling covers. Only then call `gateway.putJson`. Omit `livePhotos` for image-only items to keep stored JSON backward compatible.

- [ ] **Step 5: Serve and delete associations**

`getLibrary2Media` looks in both `images` and `livePhotos`. `deleteLibrary2Image` removes the image plus the association whose `coverFileId` matches, writes the new manifest, then best-effort deletes both COS keys. `deleteLibrary2Item` deletes all image keys, all optional Live keys, and the manifest.

- [ ] **Step 6: Run all Library2 backend tests**

Run: `npx.cmd tsx --test tests/content-library-2-service.test.ts tests/content-library-2-routes.test.ts tests/content-library-2-client.test.ts`

Expected: PASS for image-only and paired Live items.

- [ ] **Step 7: Commit the storage slice**

```powershell
git add -- app/api/library2/items/[contentId]/live/[fileId]/upload/route.ts app/api/library2/items/[contentId]/commit/route.ts app/api/library2/items/[contentId]/media/[fileId]/route.ts lib/content-library-2/service.ts tests/content-library-2-routes.test.ts tests/content-library-2-service.test.ts
git commit -m "feat: persist paired Live photos in Library2"
```

### Task 6: Complete the extension upload orchestration

**Files:**
- Modify: `browser-extension/background.js`
- Modify: `browser-extension/library2-bar.js`
- Modify: `browser-extension/shared/library2-live.js`
- Test: `tests/library2-page-extract.test.ts`
- Test: `tests/library2-live.test.ts`

- [ ] **Step 1: Add failing orchestration contract tests**

Assert the background sends both descriptor lists, uploads all images via the four-way helper, iterates `intent.liveUploads` with `await` sequentially, and commits `{ content, uploads, liveUploads }`. Add an executable helper test where three Live workers record `peak === 1` and preserve order.

- [ ] **Step 2: Run extension tests and verify failure**

Run: `npx.cmd tsx --test tests/library2-upload.test.ts tests/library2-live.test.ts tests/library2-page-extract.test.ts`

Expected: FAIL because Live upload orchestration is not wired to the API.

- [ ] **Step 3: Send paired descriptors and upload in the required order**

After the bar collects pairs, send `livePhotos` as `{ order, coverIndex, videoSource }`. The background first downloads all normal cover images, preserving the pair's cover indexes, then creates the intent:

```js
body: JSON.stringify({
  images: images.map(({ contentType, size }) => ({ contentType, size })),
  livePhotos: preparedLive.map(({ order, coverIndex, video }) => ({
    order,
    coverIndex,
    contentType: "video/mp4",
    size: video.size
  }))
})
```

Normal image PUTs use the Task 1 four-way helper. Live PUTs use a plain ordered loop; each iteration downloads an official remote MP4 or requests one blob stream from the sender tab, validates it, uploads it, and drops the bytes. Reject the entire action before commit if any pair fails.

- [ ] **Step 4: Commit both server-issued lists**

Send `uploads: intent.uploads` and `liveUploads: intent.liveUploads`. Return success only after the commit route responds with `ok: true`. Error messages retain the original one-based pair index.

- [ ] **Step 5: Run extension and backend integration tests**

Run: `npx.cmd tsx --test tests/library2-upload.test.ts tests/library2-live.test.ts tests/library2-page-extract.test.ts tests/content-library-2-routes.test.ts`

Expected: PASS; image peak is four, Live peak is one, and commit is skipped after any upload failure.

- [ ] **Step 6: Commit the orchestration slice**

```powershell
git add -- browser-extension/background.js browser-extension/library2-bar.js browser-extension/shared/library2-live.js tests/library2-upload.test.ts tests/library2-live.test.ts tests/library2-page-extract.test.ts
git commit -m "feat: upload Live photo pairs to Library2"
```

### Task 7: Preview Live videos and keep fission static

**Files:**
- Modify: `app/content-library-2/page.tsx`
- Modify: `lib/content-library-2/client.ts`
- Test: `tests/content-library-2-contract.test.ts`
- Test: `tests/content-library-2-generation.test.ts`

- [ ] **Step 1: Add failing UI and fission regression tests**

Extend the generation fixture with one `livePhotos` entry and keep this expectation:

```ts
const payload = library2PrefillPayload(liveItem);
assert.equal(payload.media.length, liveItem.images.length);
assert.equal(payload.media.some((media) => media.url.endsWith(".mp4")), false);
```

The UI contract test must find `livePhotos`, a `LIVE` badge, a `<video`, `poster=`, and a confirmation message explaining that deleting a Live cover also deletes its paired video.

- [ ] **Step 2: Run UI/generation tests and verify failure**

Run: `npx.cmd tsx --test tests/content-library-2-contract.test.ts tests/content-library-2-generation.test.ts`

Expected: UI contract FAIL; the fission regression should already PASS or require only fixture typing adjustments.

- [ ] **Step 3: Render paired playback**

For each item, build a map from `coverFileId` to Live association. A paired cover gets a visible `LIVE` badge; clicking it opens the existing modal as:

```tsx
<video
  src={library2MediaUrl(item.id, live.videoFileId)}
  poster={library2MediaUrl(item.id, live.coverFileId)}
  controls
  autoPlay
  className="max-h-full max-w-full rounded-lg object-contain"
/>
```

Unpaired images keep the current image preview. Stop click propagation inside the preview so the user can operate video controls.

- [ ] **Step 4: Explain paired deletion and preserve static fission**

If a cover is paired, ask `确定删除这组 Live 吗？静态封面和对应视频会一起删除。`; otherwise retain the current image message. Do not add Live URLs to `library2PrefillPayload`; it must continue mapping only `item.images`.

- [ ] **Step 5: Run UI/generation tests**

Run: `npx.cmd tsx --test tests/content-library-2-contract.test.ts tests/content-library-2-generation.test.ts`

Expected: PASS; UI previews MP4 and fission contains only static covers.

- [ ] **Step 6: Commit the UI slice**

```powershell
git add -- app/content-library-2/page.tsx lib/content-library-2/client.ts tests/content-library-2-contract.test.ts tests/content-library-2-generation.test.ts
git commit -m "feat: preview paired Live photos in Library2"
```

### Task 8: Publish extension 0.1.33 and verify the complete workflow

**Files:**
- Modify: `browser-extension/manifest.template.json`
- Modify: `扩展/manifest.json`
- Modify: `扩展/background.js`
- Modify: `扩展/library2-bar.js`
- Modify: `扩展/shared/library2-live.js`
- Modify: `扩展/shared/library2-media.js`
- Modify: `扩展/shared/library2-upload.js`
- Modify: `扩展/shared/page-extract.js`
- Modify: `scripts/package-xhs-extension.ps1`
- Modify: `app/api/extension/download/route.ts`
- Modify: `tests/xhs-extension-download-route.test.ts`
- Modify: `tests/xhs-extension-download.test.ts`
- Modify: `tests/xhs-extension-protocol.test.ts`
- Create: `public/downloads/xhs-browser-extension-0.1.33.zip`

- [ ] **Step 1: Update version assertions to 0.1.33 and verify they fail**

Replace the expected current version in the three download/protocol tests, then run:

Run: `npx.cmd tsx --test tests/xhs-extension-download-route.test.ts tests/xhs-extension-download.test.ts tests/xhs-extension-protocol.test.ts`

Expected: FAIL because the manifest, route, script, mirror, and ZIP still expose 0.1.32.

- [ ] **Step 2: Bump and synchronize the extension**

Set `0.1.33` in the canonical manifest, `扩展/manifest.json`, packaging wrapper, and download redirect. Copy only the changed canonical runtime files into `扩展`; preserve its generated manifest structure and set the new helper ordering before `library2-bar.js`.

- [ ] **Step 3: Package the production ZIP**

Run: `powershell -ExecutionPolicy Bypass -File scripts/package-xhs-extension.ps1`

Expected: `public/downloads/xhs-browser-extension-0.1.33.zip` exists and the command prints its SHA-256.

- [ ] **Step 4: Run targeted tests and type/build checks**

Run:

```powershell
npx.cmd tsx --test tests/library2-upload.test.ts tests/library2-live.test.ts tests/library2-page-extract.test.ts tests/content-library-2-service.test.ts tests/content-library-2-routes.test.ts tests/content-library-2-contract.test.ts tests/content-library-2-generation.test.ts tests/xhs-extension-download-route.test.ts tests/xhs-extension-download.test.ts tests/xhs-extension-protocol.test.ts
npx.cmd tsc --noEmit
npm.cmd run build
```

Expected: all targeted tests PASS, TypeScript exits 0, and Next.js production build exits 0.

- [ ] **Step 5: Run the full regression suite**

Run: `npm.cmd test`

Expected: all tests PASS with no new skipped or cancelled tests.

- [ ] **Step 6: Inspect the packaged artifact**

Expand the ZIP into a new temporary directory, then verify its manifest version is `0.1.33`; it contains `shared/library2-live.js` and `shared/library2-upload.js`; and no source maps, credentials, `.env` files, or `__APP_MATCH_PATTERN__` remain. Remove only that verified temporary directory afterward.

- [ ] **Step 7: Review the exact diff and commit release files**

Run:

```powershell
git diff --check
git status -sb
git diff --stat
```

Stage only the intended source, test, mirror, plan, and `0.1.33` ZIP files. Do not stage existing `.next-*` directories or old untracked ZIPs.

```powershell
git commit -m "feat: save Xiaohongshu Live photos"
```

- [ ] **Step 8: Runtime acceptance check**

Reload the unpacked extension in both Chrome and Edge. On a three-item Xiaohongshu Live note, verify the bar says three Live groups, upload reaches Library2, the saved item has three static covers with three LIVE badges, every cover plays its own video, deleting one group removes only that cover/video pair, and `爆款裂变` receives the remaining static covers with no MP4. On a normal multi-image note, verify up to four image PUT requests overlap and stored order matches the source order.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Library2Upload = api;
})(globalThis, function () {
  async function runBounded(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;

    async function runWorker() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }

    const workerCount = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: workerCount }, runWorker));
    return results;
  }

  function uploadLibraryImages(uploads, put) {
    return runBounded(uploads, 4, async (upload, index) => {
      const response = await put(upload, index);
      if (!response.ok) throw new Error(`第 ${index + 1} 张图片上传失败`);
      return true;
    });
  }

  return Object.freeze({ runBounded, uploadLibraryImages });
});

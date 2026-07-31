import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/content/page.tsx", "utf8");
const imageStoreSource = readFileSync("lib/utils/image-store.ts", "utf8");

test("persists keyword-library and image-draft state with versioned keys", () => {
  assert.equal(source.includes("content-production-studio.keyword-library"), true);
  assert.equal(source.includes("content-production-studio.image-draft"), true);
  assert.equal(source.includes("loadVersionedState"), true);
  assert.equal(source.includes("saveVersionedState"), true);
  assert.equal(source.includes("if (!saveVersionedState"), true);
});

test("new and selected works do not receive preselected keywords", () => {
  assert.equal(source.includes("withoutSelectedKeywords"), true);
  assert.equal(source.includes("visibleKeywordLibrary.slice(0, 4)"), false);
});

test("P-page prompt fields and requests no longer fall back to mock prompts", () => {
  assert.equal(source.includes("planPromptMap[item.page] ?? item.prompt"), false);
  assert.equal(source.includes("planPromptMap[page] || plan.prompt"), false);
  assert.equal(source.includes("planPromptMap[page] ?? plan.prompt"), false);
  assert.equal(source.includes("useState(\"延续参考作品结构，但画面更干净真实；突出通勤、防晒补涂、清爽肤感。\")"), false);
  assert.equal(source.includes("const [imagePromptText, setImagePromptText] = useState(\"\")"), true);
});

test("local source images use a stable IndexedDB reference", () => {
  assert.equal(source.includes("persistImageFile"), true);
  assert.equal(imageStoreSource.includes("export async function persistImageFile"), true);
});

test("parsed reference images automatically fill empty image-plan reference slots", () => {
  assert.equal(source.includes("autoAssignReferenceImagesToPlans"), true);
  assert.equal(source.includes("void autoAssignReferenceImagesToPlans(parsedMedia, nextImagePlans)"), true);
  assert.equal(source.includes("(items[plan.page] ?? []).length"), true);
  assert.equal(source.includes("sources[plan.page - 1]"), true);
  assert.equal(source.includes("createReferenceImagePlans"), true);
});

test("local saving is selection-based and writes through the browser file helper", () => {
  assert.equal(source.includes("localSaveSelectedUrls"), true);
  assert.equal(source.includes("writeBlobFiles"), true);
  assert.equal(source.includes("showDirectoryPicker"), true);
  assert.equal(source.includes("directoryPickerFailure(error)"), true);
  assert.equal(source.includes("setDirectoryPickerSupported(false)"), true);
  assert.equal(source.includes("已保存本地图文项目到"), false);
});

test("generated image bytes are persisted immediately instead of retaining provider URLs", () => {
  assert.equal(source.includes("materializeGeneratedImagePayload"), false);
  assert.equal(source.includes("persistImageFile(blob, `generated_"), true);
  assert.equal(source.includes("storageUrl"), true);
});

test("image-plan pages are generated one at a time", () => {
  assert.equal(source.includes("const generateAllPlanImages = async () =>"), true);
  assert.equal(source.includes("for (const [index, page] of pages.entries())"), true);
  assert.equal(source.includes("await generateSinglePlanImage(page, false)"), true);
  assert.equal(source.includes("Promise.all(pages.map((page) => generateSinglePlanImage(page, false)))"), false);
  assert.equal(source.includes("if (imagePageGenerationLock.current)"), true);
  assert.equal(source.includes("disabled={generatingAllPages || Object.keys(generatingImagePages).length > 0}"), true);
  assert.equal(source.includes("依次生成全部页面"), true);
  assert.equal(source.includes("正在依次生成"), true);
});

test("finished preview starts empty and supports manual upload and ordering", () => {
  assert.equal(source.includes("setFinishedImageAssignments({})"), true);
  assert.equal(source.includes("buildDefaultImageAssignments"), false);
  assert.equal(source.includes("reorderAssignedImages"), true);
  assert.equal(source.includes("event.clientX"), true);
  assert.equal(source.includes("上传图片"), true);
  assert.equal(source.includes("prependAssignedImages"), true);
  assert.equal(source.includes("removeAssignedImage"), true);
  assert.equal(source.includes("删除上传图片"), true);
  assert.equal(source.includes("z-[80]"), true);
});

test("finished content reports the number of images actually selected", () => {
  assert.equal(source.includes("mediaUrls.length || imagePlanItems.length"), false);
});

test("copy generation requires a product-library selection and sends its full context", () => {
  assert.equal(source.includes("const selectedCopyProduct ="), true);
  assert.equal(source.includes("formatProductCopyContext(selectedCopyProduct)"), true);
  assert.equal(source.includes("product: copyProductContext"), true);
  assert.equal(source.includes("请选择产品资料库里的产品后再生成发布文案"), true);
  assert.equal(source.includes("const nextCopies = expandCopyCandidates(copyCandidates, parsedReference.title);"), false);
});

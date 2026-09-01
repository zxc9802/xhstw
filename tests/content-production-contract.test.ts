import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/content/page.tsx", "utf8");
const imageStoreSource = readFileSync("lib/utils/image-store.ts", "utf8");
const imageTypeSource = readFileSync("types/image.ts", "utf8");
const envExampleSource = readFileSync(".env.example", "utf8");
const promptLibraryDialogPath = "components/content/PromptLibraryDialog.tsx";
const promptLibraryDialogSource = existsSync(promptLibraryDialogPath)
  ? readFileSync(promptLibraryDialogPath, "utf8")
  : "";

test("prompt library dialog provides search and complete local CRUD controls", () => {
  assert.equal(promptLibraryDialogSource.includes("提示词库 · 填入 P"), true);
  assert.equal(promptLibraryDialogSource.includes("搜索名称或提示词内容"), true);
  assert.equal(promptLibraryDialogSource.includes("名称（选填）"), true);
  assert.equal(promptLibraryDialogSource.includes("提示词内容"), true);
  assert.equal(promptLibraryDialogSource.includes("未命名提示词"), true);
  assert.equal(promptLibraryDialogSource.includes("window.confirm"), true);
  assert.equal(promptLibraryDialogSource.includes("使用"), true);
  assert.equal(promptLibraryDialogSource.includes("编辑"), true);
  assert.equal(promptLibraryDialogSource.includes("删除"), true);
});

test("all image provider selectors expose nanobanan新", () => {
  assert.equal(imageTypeSource.includes('"nanobanan新"'), true);
  assert.match(
    source,
    /const imageProviders: ImageProvider\[\] = \[[^\]]*"nanobanan新"/
  );
});

test("all image provider selectors expose gpt-image-2-c", () => {
  assert.equal(imageTypeSource.includes('"gpt-image-2-c"'), true);
  assert.match(
    source,
    /const imageProviders: ImageProvider\[\] = \[[^\]]*"gpt-image-2-c"/
  );
});

test("all image provider selectors expose gpt-image2-vip", () => {
  assert.equal(imageTypeSource.includes('"gpt-image2-vip"'), true);
  assert.match(
    source,
    /const imageProviders: ImageProvider\[\] = \[[^\]]*"gpt-image2-vip"/
  );
});

test("documents server-only APIYI image configuration", () => {
  for (const name of [
    "APIYI_IMAGE_API_KEY=",
    "APIYI_IMAGE_URL=https://api.apiyi.com/v1/images/generations",
    "APIYI_IMAGE_EDIT_URL=https://api.apiyi.com/v1/images/edits",
    "APIYI_IMAGE_MODEL=gpt-image-2-vip"
  ]) {
    assert.equal(envExampleSource.includes(name), true, name);
  }
  assert.equal(source.includes("APIYI_IMAGE_API_KEY"), false);
});

test("persists only the unrelated keyword library, not generated drafts", () => {
  assert.equal(source.includes("content-production-studio.keyword-library"), true);
  assert.equal(source.includes("content-production-studio.image-draft"), false);
  assert.equal(source.includes("content-production-studio-xhs.generated-images"), false);
  assert.equal(source.includes("loadVersionedState"), true);
  assert.equal(source.includes("saveVersionedState"), true);
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

test("keeps generated image bytes in memory until COS save", () => {
  assert.equal(source.includes("materializeGeneratedImagePayload"), false);
  assert.equal(source.includes("persistImageFile(blob, `generated_"), false);
  assert.equal(source.includes("blob: Blob"), true);
  assert.equal(source.includes("URL.createObjectURL(blob)"), true);
});

test("saves final content through COS without a local fallback", () => {
  assert.equal(source.includes("saveContentDraftToCos"), true);
  assert.equal(source.includes("FINISHED_CONTENT_STORAGE_KEY"), false);
  assert.equal(source.includes("window.localStorage.setItem(FINISHED_CONTENT_STORAGE_KEY"), false);
  assert.equal(source.includes("QuotaExceededError"), false);
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

test("asks before saving finished works that have no selected images", () => {
  assert.equal(source.includes("有作品还没有选择图片"), true);
  assert.equal(source.includes("暂无真实图片"), true);
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

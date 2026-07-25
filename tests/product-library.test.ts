import assert from "node:assert/strict";
import test from "node:test";
import { formatProductCopyContext } from "../lib/utils/product-library";

test("formats the complete product-library record for copy generation", () => {
  const context = formatProductCopyContext({
    id: "product_1",
    name: "山茶花修护精华",
    category: "护肤",
    sellingPoint: "舒缓泛红；轻薄好吸收",
    painPoint: "换季干痒；底妆卡粉",
    other: "禁用词：根治；场景：晚间修护",
    assets: [],
    status: "active"
  });

  assert.equal(context, "产品名称：山茶花修护精华\n产品分类：护肤\n核心卖点：舒缓泛红；轻薄好吸收\n核心痛点：换季干痒；底妆卡粉\n补充要求：禁用词：根治；场景：晚间修护");
});

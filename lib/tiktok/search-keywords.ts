import sunscreenKeywords from "./sunscreen-keywords.json";

export function buildSearchKeywords(input: string, region: string) {
  const seeds = input.split(/[\n,，]+/).map(value => value.trim()).filter(Boolean);
  const expanded = seeds.flatMap(seed => {
    if (/^(防晒霜|防晒乳|防晒|sunscreen|sunblock|suncream|krim pelindung matahari)$/i.test(seed)) {
      return [seed, ...sunscreenKeywords.filter(word => region === "MY" || !/马来西亚|malaysia|matahari|suria|krim|muka|murah|terbaik|kulit|ringan|melekit|tanpa|wajah|untuk|harian|lokal/i.test(word))];
    }
    return [seed, `${seed} review`, `${seed} 推荐`, `${seed} 测评`, `${seed} 好用`, `${seed} affordable`];
  });
  return [...new Set([...seeds, ...expanded])].slice(0, 120);
}

// Additional topical evidence for the validated sunscreen workflow. Other products
// use the user's explicit search terms without inventing a category from captions.
export function needsSunscreenEvidence(input: string) {
  return /^(防晒霜|防晒乳|防晒|sunscreen|sunblock|suncream|krim pelindung matahari)$/i.test(input.trim());
}

export function hasSunscreenEvidence(caption: string) {
  const text = caption.normalize("NFKC");
  if (/sun\s*block\s+in\s+night|#(?:comedy|prank|meme)\b/i.test(text)) return false;
  return /防晒|sun\s*scr[e]+n|sun\s*block|sun\s*cream|pelindung\s+(?:matahari|suria)|uv\s*block\s*cream/i.test(text);
}

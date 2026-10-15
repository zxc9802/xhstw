import countryNames from "./country-names.json";

// Fixed CLDR names keep server and browser markup identical across Intl versions.
// https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-localenames-full/main/zh/territories.json
const names: Record<string, string> = countryNames;
const codes = Object.keys(names);
const common = ["MY", "US", "GB", "SG", "ID", "TH", "VN", "PH", "CA", "AU", "JP", "KR"];

export const countryOptions = [...common, ...codes.filter(code => !common.includes(code))].map(code => ({
  code, label: `${names[code]}（${code}）`
}));

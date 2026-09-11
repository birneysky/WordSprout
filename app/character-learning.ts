import cnchar from "cnchar";
import order from "cnchar-order";
import { customPinyin, pinyin, polyphonic } from "pinyin-pro";

cnchar.use(order);

customPinyin({
  盛饭: "chéng fàn",
  盛粥: "chéng zhōu",
  盛汤: "chéng tāng",
  盛水: "chéng shuǐ",
  盛菜: "chéng cài",
  盛东西: "chéng dōng xi",
  背东西: "bēi dōng xi",
  背书包: "bēi shū bāo",
  背行李: "bēi xíng li",
  背孩子: "bēi hái zi",
  背着: "bēi zhe",
  背起: "bēi qǐ",
});

const COMMON_POLYPHONIC_READINGS: Record<string, string[]> = {
  行: ["xing2", "hang2"],
  盛: ["sheng4", "cheng2"],
  背: ["bei1", "bei4"],
  薄: ["bo2", "bao2", "bo4"],
};

export type Reading = {
  pinyin: string;
  tone: number;
  toneLabel: string;
  audioKey: string;
};

export const STROKE_AUDIO_NAMES: Record<string, string> = {
  横折折撇: "heng-zhe-zhe-pie",
  竖弯: "shu-wan",
  横折: "heng-zhe",
  横斜钩: "heng-xie-gou",
  横: "heng",
  捺: "na",
  横折钩: "heng-zhe-gou",
  竖: "shu",
  竖钩: "shu-gou",
  点: "dian",
  撇: "pie",
  撇折: "pie-zhe",
  竖折撇: "shu-zhe-pie",
  竖折折: "shu-zhe-zhe",
  横折折折钩: "heng-zhe-zhe-zhe-gou",
  横撇弯钩: "heng-pie-wan-gou",
  竖折折钩: "shu-zhe-zhe-gou",
  提: "ti",
  弯钩: "wan-gou",
  斜钩: "xie-gou",
  卧钩: "wo-gou",
  横折折: "heng-zhe-zhe",
  横折弯: "heng-zhe-wan",
  横撇: "heng-pie",
  横钩: "heng-gou",
  横折提: "heng-zhe-ti",
  横折折折: "heng-zhe-zhe-zhe",
  竖提: "shu-ti",
  撇点: "pie-dian",
  竖弯钩: "shu-wan-gou",
};

export function getStrokeNames(char: string) {
  const result = cnchar.stroke(char, "order", "name") as unknown;
  if (!Array.isArray(result) || !Array.isArray(result[0])) return [];
  return (result[0] as string[]).map((name) => name.split("|")[0]);
}

function createReading(symbol: string, numberedPinyin: string): Reading {
  const tone = Number(numberedPinyin.match(/[0-5]/)?.[0] ?? 5);
  return {
    pinyin: symbol,
    tone,
    toneLabel: tone === 5 || tone === 0 ? "轻声" : `第${["", "一", "二", "三", "四"][tone]}声`,
    audioKey: numberedPinyin.toLowerCase().replaceAll("ü", "v"),
  };
}

export function getReadings(text: string): Reading[] {
  const symbols = pinyin(text, { type: "array", toneType: "symbol" });
  const numbered = pinyin(text, { type: "array", toneType: "num" });
  return symbols.map((symbol, index) => createReading(symbol, numbered[index] ?? ""));
}

export function getReadingOptions(text: string): Reading[][] {
  const contextualReadings = getReadings(text);
  const symbolsByCharacter = polyphonic(text, { type: "array", toneType: "symbol" });
  const numberedByCharacter = polyphonic(text, { type: "array", toneType: "num" });

  return Array.from(text).map((char, index) => {
    const allReadings = (symbolsByCharacter[index] ?? []).map((symbol, optionIndex) =>
      createReading(symbol, numberedByCharacter[index]?.[optionIndex] ?? ""),
    );
    const commonKeys = COMMON_POLYPHONIC_READINGS[char];
    const commonReadings = commonKeys
      ? allReadings
          .filter((item) => commonKeys.includes(item.audioKey))
          .sort((left, right) => commonKeys.indexOf(left.audioKey) - commonKeys.indexOf(right.audioKey))
      : allReadings;
    const uniqueReadings = new Map<string, Reading>();

    for (const item of [contextualReadings[index], ...commonReadings]) {
      if (item?.audioKey) uniqueReadings.set(item.audioKey, item);
    }
    return [...uniqueReadings.values()];
  });
}

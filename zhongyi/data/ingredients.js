"use strict";

// P1 的20条高信息量种子保留完整公告字段；P3 同时覆盖现行106项食药物质目录。
// 2002年名单只证明名称收录，未逐项提供基原、部位和食用形态，因此这些字段保持待复核/unknown。
// 不录入疾病疗效、个体治疗方案或组合建议；未被来源明确支持的安全字段保持 unknown。

const schemaVersion = "1.2.0";
const contentVersion = "2026.08-full-catalog.1";
const publishedAt = "2026-08-10";
const catalogCoverage = Object.freeze({
  asOf: "2026-08-10",
  officialCount: 106,
  batches: Object.freeze([
    Object.freeze({ id: "legacy-2002", count: 87, sourceId: "nhc-food-medicine-list-2002" }),
    Object.freeze({ id: "announcement-2019-8", count: 6, sourceId: "nhc-announcement-2019-8" }),
    Object.freeze({ id: "announcement-2023-9", count: 9, sourceId: "nhc-announcement-2023-9" }),
    Object.freeze({ id: "announcement-2024-4", count: 4, sourceId: "nhc-announcement-2024-4" })
  ]),
  countConfirmationSourceId: "nhc-current-catalog-count-2025"
});

const SOURCES = {
  catalogRule: {
    id: "nhc-catalog-rule-2021",
    status: "published",
    type: "official_rule",
    title: "按照传统既是食品又是中药材的物质目录管理规定",
    publisher: "中华人民共和国国家卫生健康委员会",
    url: "https://www.nhc.gov.cn/sps/c100088/202111/a0f07a6f1d4f4607add51e5a9de73abe.shtml",
    publishedAt: "2021-11-15",
    checkedAt: "2026-08-09",
    scope: "支持目录动态管理和食品宣传不得涉及疾病预防、治疗功能等产品边界。"
  },
  batch2019: {
    id: "nhc-announcement-2019-8",
    status: "published",
    type: "official_announcement",
    title: "关于当归等6种新增按照传统既是食品又是中药材的物质公告（2019年第8号）",
    publisher: "国家卫生健康委、国家市场监督管理总局",
    url: "https://www.nhc.gov.cn/wjw/c100175/202001/60977058ce3b4449b1b1d46cff283e73.shtml",
    publishedAt: "2019-11-25",
    checkedAt: "2026-08-09",
    scope: "支持6种物质的名称、植物身份、科名、部位及仅作香辛料和调味品使用的限制。"
  },
  batch2023: {
    id: "nhc-announcement-2023-9",
    status: "published",
    type: "official_announcement",
    title: "关于党参等9种新增按照传统既是食品又是中药材的物质公告（2023年第9号）",
    publisher: "国家卫生健康委、国家市场监督管理总局",
    url: "https://www.nhc.gov.cn/wjw/c100175/202311/59e03b384f9a4d0b9623e19b813f6cc4.shtml",
    publishedAt: "2023-11-09",
    checkedAt: "2026-08-09",
    scope: "支持9种物质纳入目录及附件中的身份信息。"
  },
  batch2023Guide: {
    id: "nhc-interpretation-2023-9",
    status: "published",
    type: "official_interpretation",
    title: "解读《关于党参等9种新增按照传统既是食品又是中药材的物质公告》",
    publisher: "中华人民共和国国家卫生健康委员会",
    url: "https://www.nhc.gov.cn/sps/c100088/202311/a7e49f9f0285437b82b842576fa8ede9.shtml",
    publishedAt: "2023-11-17",
    checkedAt: "2026-08-09",
    scope: "支持传统食品形态、特殊人群不推荐食用及个别条目的明确注意事项。"
  },
  batch2024: {
    id: "nhc-announcement-2024-4",
    status: "published",
    type: "official_announcement",
    title: "关于地黄等4种按照传统既是食品又是中药材的物质的公告（2024年第4号）",
    publisher: "国家卫生健康委、国家市场监督管理总局",
    url: "https://www.nhc.gov.cn/sps/c100088/202408/53150d0918ec40899b5293147ec0dd01.shtml",
    publishedAt: "2024-08-12",
    checkedAt: "2026-08-09",
    scope: "支持4种物质纳入目录及附件中的身份信息。"
  },
  batch2024Guide: {
    id: "nhc-interpretation-2024-4",
    status: "published",
    type: "official_interpretation",
    title: "解读《关于地黄等4种按照传统既是食品又是中药材的物质的公告》",
    publisher: "中华人民共和国国家卫生健康委员会",
    url: "https://www.nhc.gov.cn/sps/c100087/202408/aa9a6f7bce8e4b4cbcc4b38591676ed6.shtml",
    publishedAt: "2024-08-26",
    checkedAt: "2026-08-09",
    scope: "支持身份、传统食品形态及特殊人群不推荐食用信息。"
  },
  legacyList: {
    id: "nhc-food-medicine-list-2002",
    status: "published",
    type: "official_catalog",
    title: "既是食品又是药品的物品名单",
    publisher: "中华人民共和国国家卫生健康委员会",
    url: "https://www.nhc.gov.cn/sps/c100088/200203/68aa338c814d4a0a9fe5fb6a46717b99.shtml",
    publishedAt: "2002-03",
    checkedAt: "2026-08-09",
    scope: "支持2002年公布的87个名称列入官方名单；该名单页不提供逐项拉丁学名、科名和可食部位。"
  },
  catalogCount2025: {
    id: "nhc-current-catalog-count-2025",
    status: "published",
    type: "official_response",
    title: "对十四届全国人大三次会议第2643号建议的答复",
    publisher: "中华人民共和国国家卫生健康委员会",
    url: "https://www.nhc.gov.cn/wjw/jiany/202508/6141c788fa794723afb4e71af48b3d93.shtml",
    publishedAt: "2025-09-04",
    checkedAt: "2026-08-10",
    scope: "支持国家卫生健康委截至2025年公开确认食药物质目录共106种；与2002年87种及后续19种正式增补进行数量交叉核验。"
  },
  gojiTip: {
    id: "samr-goji-consumer-tip-2023",
    status: "published",
    type: "official_consumer_information",
    title: "枸杞子的消费提示",
    publisher: "国家市场监督管理总局",
    url: "https://www.samr.gov.cn/spcjs/yjjl/art/2023/art_87ec1193abf84dd4b056f055e9df600b.html",
    publishedAt: "2023-12-25",
    checkedAt: "2026-08-09",
    scope: "支持枸杞子的食品身份辨识和常见食品使用形态。"
  }
};

const SPECIAL_POPULATION_LIMIT = {
  pregnancy: "no",
  breastfeeding: "no",
  infantsToddlers: "no"
};

const ROWS = [
  {
    id: "dang-gui", name: "当归", pinyin: "dang gui", aliases: [],
    latinName: "Angelica sinensis (Oliv.) Diels", family: "伞形科", ediblePart: "根",
    batch: "2019年第8号", sourceIds: ["batch2019"], usageTypes: ["seasoning"], goals: ["seasoning"],
    tags: ["根类", "香辛料"], restrictionCode: "seasoning_only"
  },
  {
    id: "shan-nai", name: "山柰", pinyin: "shan nai", aliases: [],
    latinName: "Kaempferia galanga L.", family: "姜科", ediblePart: "根茎",
    batch: "2019年第8号", sourceIds: ["batch2019"], usageTypes: ["seasoning"], goals: ["seasoning"],
    tags: ["根茎类", "香辛料"], restrictionCode: "seasoning_only"
  },
  {
    id: "xi-hong-hua", name: "西红花", pinyin: "xi hong hua", aliases: ["藏红花（香辛料名称）"],
    plantNames: ["番红花"],
    latinName: "Crocus sativus L.", family: "鸢尾科", ediblePart: "柱头",
    batch: "2019年第8号", sourceIds: ["batch2019"], usageTypes: ["seasoning"], goals: ["seasoning"],
    tags: ["花类", "香辛料"], restrictionCode: "seasoning_only"
  },
  {
    id: "cao-guo", name: "草果", pinyin: "cao guo", aliases: [],
    latinName: "Amomum tsao-ko Crevost et Lemaire", family: "姜科", ediblePart: "果实",
    batch: "2019年第8号", sourceIds: ["batch2019"], usageTypes: ["seasoning"], goals: ["seasoning"],
    tags: ["果实类", "香辛料"], restrictionCode: "seasoning_only"
  },
  {
    id: "jiang-huang", name: "姜黄", pinyin: "jiang huang", aliases: [],
    latinName: "Curcuma longa L.", family: "姜科", ediblePart: "根茎",
    batch: "2019年第8号", sourceIds: ["batch2019"], usageTypes: ["seasoning"], goals: ["seasoning"],
    tags: ["根茎类", "香辛料"], restrictionCode: "seasoning_only"
  },
  {
    id: "bi-ba", name: "荜茇", pinyin: "bi ba", aliases: [],
    latinName: "Piper longum L.", family: "胡椒科", ediblePart: "果穗",
    batch: "2019年第8号", sourceIds: ["batch2019"], usageTypes: ["seasoning"], goals: ["seasoning"],
    tags: ["果穗类", "香辛料"], restrictionCode: "seasoning_only"
  },
  {
    id: "dang-shen", name: "党参", pinyin: "dang shen", aliases: [],
    plantNames: ["党参", "素花党参", "川党参"],
    latinName: "Codonopsis pilosula (Franch.) Nannf.；Codonopsis pilosula Nannf. var. modesta (Nannf.) L.T. Shen；Codonopsis tangshen Oliv.", family: "桔梗科", ediblePart: "根",
    batch: "2023年第9号", sourceIds: ["batch2023", "batch2023Guide"], usageTypes: ["traditional_food"], goals: ["traditional_food_form"],
    tags: ["根类", "新增目录"], specialPopulationLimit: true, drugInteractions: ["藜芦"]
  },
  {
    id: "rou-cong-rong-huang-mo", name: "肉苁蓉（荒漠）", pinyin: "rou cong rong huang mo", aliases: ["荒漠肉苁蓉"],
    plantNames: ["肉苁蓉"],
    latinName: "Cistanche deserticola Y.C. Ma", family: "列当科", ediblePart: "肉质茎",
    batch: "2023年第9号", sourceIds: ["batch2023", "batch2023Guide"], usageTypes: ["traditional_food"], goals: ["traditional_food_form"],
    tags: ["肉质茎", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "tie-pi-shi-hu", name: "铁皮石斛", pinyin: "tie pi shi hu", aliases: [],
    latinName: "Dendrobium officinale Kimura et Migo", family: "兰科", ediblePart: "茎",
    batch: "2023年第9号", sourceIds: ["batch2023", "batch2023Guide"], usageTypes: ["drink", "soup", "traditional_food"], goals: ["daily_drink", "soup_pairing", "traditional_food_form"],
    tags: ["茎类", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "xi-yang-shen", name: "西洋参", pinyin: "xi yang shen", aliases: [],
    latinName: "Panax quinquefolium L.", family: "五加科", ediblePart: "根",
    batch: "2023年第9号", sourceIds: ["batch2023", "batch2023Guide"], usageTypes: ["drink", "porridge", "soup", "traditional_food"], goals: ["daily_drink", "porridge_pairing", "soup_pairing", "traditional_food_form"],
    tags: ["根类", "新增目录"], specialPopulationLimit: true, drugInteractions: ["藜芦"]
  },
  {
    id: "huang-qi", name: "黄芪", pinyin: "huang qi", aliases: [],
    plantNames: ["蒙古黄芪", "膜荚黄芪"],
    latinName: "Astragalus membranaceus (Fisch.) Bge. var. mongholicus (Bge.) Hsiao；Astragalus membranaceus (Fisch.) Bge.", family: "豆科", ediblePart: "根",
    batch: "2023年第9号", sourceIds: ["batch2023", "batch2023Guide"], usageTypes: ["porridge", "soup", "traditional_food"], goals: ["porridge_pairing", "soup_pairing", "traditional_food_form"],
    tags: ["根类", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "ling-zhi", name: "灵芝", pinyin: "ling zhi", aliases: [],
    plantNames: ["赤芝", "紫芝"],
    latinName: "Ganoderma lucidum (Leyss. ex Fr.) Karst.；Ganoderma sinense Zhao, Xu et Zhang", family: "多孔菌科", ediblePart: "子实体",
    batch: "2023年第9号", sourceIds: ["batch2023", "batch2023Guide"], usageTypes: ["drink", "soup", "traditional_food"], goals: ["daily_drink", "soup_pairing", "traditional_food_form"],
    tags: ["菌类", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "shan-zhu-yu", name: "山茱萸", pinyin: "shan zhu yu", aliases: [],
    latinName: "Cornus officinalis Sieb. et Zucc.", family: "山茱萸科", ediblePart: "果肉",
    batch: "2023年第9号", sourceIds: ["batch2023", "batch2023Guide"], usageTypes: ["drink", "soup", "traditional_food"], goals: ["daily_drink", "soup_pairing", "traditional_food_form"],
    tags: ["果肉类", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "tian-ma", name: "天麻", pinyin: "tian ma", aliases: [],
    latinName: "Gastrodia elata Bl.", family: "兰科", ediblePart: "块茎",
    batch: "2023年第9号", sourceIds: ["batch2023", "batch2023Guide"], usageTypes: ["traditional_food"], goals: ["traditional_food_form"],
    tags: ["块茎类", "新增目录"], specialPopulationLimit: true, avoidConditions: ["过敏体质"]
  },
  {
    id: "du-zhong-ye", name: "杜仲叶", pinyin: "du zhong ye", aliases: [],
    plantNames: ["杜仲"],
    latinName: "Eucommia ulmoides Oliv.", family: "杜仲科", ediblePart: "叶",
    batch: "2023年第9号", sourceIds: ["batch2023", "batch2023Guide"], usageTypes: ["drink", "porridge", "staple", "traditional_food"], goals: ["daily_drink", "porridge_pairing", "breakfast_pairing", "traditional_food_form"],
    tags: ["叶类", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "di-huang", name: "地黄", pinyin: "di huang", aliases: ["熟地黄（公告所述加工品）"],
    latinName: "Rehmannia glutinosa Libosch.", family: "玄参科", ediblePart: "块根",
    batch: "2024年第4号", sourceIds: ["batch2024", "batch2024Guide"], usageTypes: ["drink", "soup", "traditional_food"], goals: ["daily_drink", "soup_pairing", "traditional_food_form"],
    tags: ["块根类", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "mai-dong", name: "麦冬", pinyin: "mai dong", aliases: [],
    latinName: "Ophiopogon japonicus (L.f) Ker-Gawl.", family: "百合科", ediblePart: "块根",
    batch: "2024年第4号", sourceIds: ["batch2024", "batch2024Guide"], usageTypes: ["drink", "porridge", "soup", "traditional_food"], goals: ["daily_drink", "porridge_pairing", "soup_pairing", "traditional_food_form"],
    tags: ["块根类", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "tian-dong", name: "天冬", pinyin: "tian dong", aliases: [],
    latinName: "Asparagus cochinchinensis (Lour.) Merr.", family: "百合科", ediblePart: "块根",
    batch: "2024年第4号", sourceIds: ["batch2024", "batch2024Guide"], usageTypes: ["drink", "porridge", "soup", "dessert", "traditional_food"], goals: ["daily_drink", "porridge_pairing", "soup_pairing", "dessert", "traditional_food_form"],
    tags: ["块根类", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "hua-ju-hong", name: "化橘红", pinyin: "hua ju hong", aliases: [],
    plantNames: ["化州柚", "柚"],
    latinName: "Citrus grandis 'Tomentosa' 或 Citrus grandis (L.) Osbeck", family: "芸香科", ediblePart: "外层果皮",
    batch: "2024年第4号", sourceIds: ["batch2024", "batch2024Guide"], usageTypes: ["drink", "soup", "dessert", "baking", "traditional_food"], goals: ["daily_drink", "soup_pairing", "dessert", "baking", "traditional_food_form"],
    tags: ["果皮类", "新增目录"], specialPopulationLimit: true
  },
  {
    id: "gou-qi-zi", name: "枸杞子", pinyin: "gou qi zi", aliases: ["枸杞"],
    plantNames: [],
    latinName: "", family: "茄科", ediblePart: "果实（具体身份与部位待发布前复核）",
    batch: "官方名单与消费提示", sourceIds: ["legacyList", "catalogCount2025", "gojiTip"], usageTypes: ["drink", "soup", "fruit", "baking", "traditional_food"], goals: ["daily_drink", "soup_pairing", "fruit_snack", "baking", "traditional_food_form"],
    tags: ["果实类", "消费提示"], identityReviewState: "pending"
  }
];

// 2002年名单只提供名称。以下86项与上面的“枸杞子”合计87项；
// 为避免把名称收录误写成基原/部位/食法证据，这里不推断任何身份或食用形态。
const LEGACY_2002_ROWS = [
  ["ding-xiang", "丁香", "ding xiang", []],
  ["ba-jiao-hui-xiang", "八角茴香", "ba jiao hui xiang", []],
  ["dao-dou", "刀豆", "dao dou", []],
  ["xiao-hui-xiang", "小茴香", "xiao hui xiang", []],
  ["xiao-ji", "小蓟", "xiao ji", []],
  ["shan-yao", "山药", "shan yao", []],
  ["shan-zha", "山楂", "shan zha", []],
  ["ma-chi-xian", "马齿苋", "ma chi xian", []],
  ["wu-shao-she", "乌梢蛇", "wu shao she", []],
  ["wu-mei", "乌梅", "wu mei", []],
  ["mu-gua", "木瓜", "mu gua", []],
  ["huo-ma-ren", "火麻仁", "huo ma ren", []],
  ["dai-dai-hua", "代代花", "dai dai hua", []],
  ["yu-zhu", "玉竹", "yu zhu", []],
  ["gan-cao", "甘草", "gan cao", []],
  ["bai-zhi", "白芷", "bai zhi", []],
  ["bai-guo", "白果", "bai guo", []],
  ["bai-bian-dou", "白扁豆", "bai bian dou", []],
  ["bai-bian-dou-hua", "白扁豆花", "bai bian dou hua", []],
  ["long-yan-rou", "龙眼肉（桂圆）", "long yan rou gui yuan", ["龙眼肉", "桂圆"]],
  ["jue-ming-zi", "决明子", "jue ming zi", []],
  ["bai-he", "百合", "bai he", []],
  ["rou-dou-kou", "肉豆蔻", "rou dou kou", []],
  ["rou-gui", "肉桂", "rou gui", []],
  ["yu-gan-zi", "余甘子", "yu gan zi", []],
  ["fo-shou", "佛手", "fo shou", []],
  ["xing-ren", "杏仁（甜、苦）", "xing ren tian ku", ["杏仁", "甜杏仁", "苦杏仁"]],
  ["sha-ji", "沙棘", "sha ji", []],
  ["mu-li", "牡蛎", "mu li", []],
  ["qian-shi", "芡实", "qian shi", []],
  ["hua-jiao", "花椒", "hua jiao", []],
  ["chi-xiao-dou", "赤小豆", "chi xiao dou", []],
  ["e-jiao", "阿胶", "e jiao", []],
  ["ji-nei-jin", "鸡内金", "ji nei jin", []],
  ["mai-ya", "麦芽", "mai ya", []],
  ["kun-bu", "昆布", "kun bu", []],
  ["zao", "枣（大枣、酸枣、黑枣）", "zao da zao suan zao hei zao", ["枣", "大枣", "酸枣", "黑枣"]],
  ["luo-han-guo", "罗汉果", "luo han guo", []],
  ["yu-li-ren", "郁李仁", "yu li ren", []],
  ["jin-yin-hua", "金银花", "jin yin hua", []],
  ["qing-guo", "青果", "qing guo", []],
  ["yu-xing-cao", "鱼腥草", "yu xing cao", []],
  ["jiang", "姜（生姜、干姜）", "jiang sheng jiang gan jiang", ["姜", "生姜", "干姜"]],
  ["zhi-ju-zi", "枳椇子", "zhi ju zi", []],
  ["zhi-zi", "栀子", "zhi zi", []],
  ["sha-ren", "砂仁", "sha ren", []],
  ["pang-da-hai", "胖大海", "pang da hai", []],
  ["fu-ling", "茯苓", "fu ling", []],
  ["xiang-yuan", "香橼", "xiang yuan", []],
  ["xiang-ru", "香薷", "xiang ru", []],
  ["tao-ren", "桃仁", "tao ren", []],
  ["sang-ye", "桑叶", "sang ye", []],
  ["sang-shen", "桑椹", "sang shen", []],
  ["ju-hong", "桔红", "ju hong", []],
  ["jie-geng", "桔梗", "jie geng", []],
  ["yi-zhi-ren", "益智仁", "yi zhi ren", []],
  ["he-ye", "荷叶", "he ye", []],
  ["lai-fu-zi", "莱菔子", "lai fu zi", []],
  ["lian-zi", "莲子", "lian zi", []],
  ["gao-liang-jiang", "高良姜", "gao liang jiang", []],
  ["dan-zhu-ye", "淡竹叶", "dan zhu ye", []],
  ["dan-dou-chi", "淡豆豉", "dan dou chi", []],
  ["ju-hua", "菊花", "ju hua", []],
  ["ju-ju", "菊苣", "ju ju", []],
  ["huang-jie-zi", "黄芥子", "huang jie zi", []],
  ["huang-jing", "黄精", "huang jing", []],
  ["zi-su", "紫苏", "zi su", []],
  ["zi-su-zi", "紫苏籽", "zi su zi", []],
  ["ge-gen", "葛根", "ge gen", []],
  ["hei-zhi-ma", "黑芝麻", "hei zhi ma", []],
  ["hei-hu-jiao", "黑胡椒", "hei hu jiao", []],
  ["huai-mi", "槐米", "huai mi", []],
  ["huai-hua", "槐花", "huai hua", []],
  ["pu-gong-ying", "蒲公英", "pu gong ying", []],
  ["feng-mi", "蜂蜜", "feng mi", []],
  ["fei-zi", "榧子", "fei zi", []],
  ["suan-zao-ren", "酸枣仁", "suan zao ren", []],
  ["xian-bai-mao-gen", "鲜白茅根", "xian bai mao gen", []],
  ["xian-lu-gen", "鲜芦根", "xian lu gen", []],
  ["fu-she", "蝮蛇", "fu she", []],
  ["ju-pi", "橘皮", "ju pi", []],
  ["bo-he", "薄荷", "bo he", []],
  ["yi-yi-ren", "薏苡仁", "yi yi ren", []],
  ["xie-bai", "薤白", "xie bai", []],
  ["fu-pen-zi", "覆盆子", "fu pen zi", []],
  ["huo-xiang", "藿香", "huo xiang", []]
].map(([id, name, pinyin, aliases]) => ({
  id,
  name,
  pinyin,
  aliases,
  plantNames: [],
  latinName: "",
  family: "",
  ediblePart: "待发布前复核",
  batch: "2002年官方名单",
  sourceIds: ["legacyList", "catalogCount2025"],
  usageTypes: [],
  goals: [],
  tags: ["2002年目录", "身份待复核"],
  identityReviewState: "pending",
  catalogOnly: true
}));

function cloneSource(key) {
  return Object.assign({}, SOURCES[key]);
}

function makeIngredient(row, index) {
  const special = row.specialPopulationLimit ? SPECIAL_POPULATION_LIMIT : {};
  const restriction = row.restrictionCode === "seasoning_only"
    ? "仅作为香辛料和调味品使用。"
    : row.catalogOnly
      ? "仅确认名称列入官方目录；基原、可食部位、食用方式及个体安全边界尚待逐项复核。"
    : "仅作食品资料展示；食品、保健食品和中药材分别按相应规定管理。";
  const sourceKeys = row.sourceIds.concat("catalogRule");
  return {
    id: row.id,
    order: index + 1,
    name: row.name,
    pinyin: row.pinyin,
    aliases: row.aliases.slice(),
    category: "food_medicine",
    batch: row.batch,
    tags: row.tags.slice(),
    goals: row.goals.slice(),
    usageTypes: row.usageTypes.slice(),
    sensory: { tastes: [] },
    identity: {
      plantNames: (row.plantNames || [row.name]).slice(),
      latinName: row.latinName,
      family: row.family,
      ediblePart: row.ediblePart,
      partReviewState: row.identityReviewState || "source_checked"
    },
    regulatory: {
      kind: "food_medicine",
      status: "listed",
      currentCatalogReviewState: "source_checked",
      restrictionCode: row.restrictionCode || "general_food_rules",
      restriction,
      sourceIds: sourceKeys.map((key) => SOURCES[key].id)
    },
    traditional: {
      reviewState: "pending",
      nature: "unknown",
      flavors: [],
      meridians: [],
      summary: ""
    },
    safety: {
      sourceIds: row.specialPopulationLimit
        ? row.sourceIds.filter((key) => key.endsWith("Guide")).map((key) => SOURCES[key].id)
        : [],
      pregnancy: special.pregnancy || "unknown",
      breastfeeding: special.breastfeeding || "unknown",
      infantsToddlers: special.infantsToddlers || "unknown",
      children: "unknown",
      olderAdults: "unknown",
      allergenKeys: [row.name].concat(row.aliases),
      allergenReviewState: "identity_only",
      avoidConditions: (row.avoidConditions || []).slice(),
      conditionReviewState: row.avoidConditions && row.avoidConditions.length ? "partial" : "pending",
      cautionConditions: [],
      drugInteractions: (row.drugInteractions || []).slice(),
      interactionReviewState: row.drugInteractions && row.drugInteractions.length ? "partial" : "pending",
      preparationWarnings: [],
      preparationReviewState: "pending"
    },
    foodUse: {
      commonForms: row.usageTypes.slice(),
      sourceIds: row.sourceIds.map((key) => SOURCES[key].id),
      mappingReviewState: "pending",
      note: row.catalogOnly
        ? "2002年名单仅证明名称收录；本条暂不提供食用形态、用量或加工建议。"
        : "受控食用形态标签用于缩小资料范围；正式发布前需逐项对照来源原文复核，不构成个体化建议。"
    },
    sources: sourceKeys.map(cloneSource),
    audit: {
      sourceCheckState: "checked",
      sourceCheckedAt: "2026-08-09",
      professionalReviewState: "pending",
      reviewedBy: [],
      reviewedAt: null,
      ingredientDigest: null,
      reviews: [],
      releaseStage: row.catalogOnly ? "catalog_only" : "seed",
      note: row.catalogOnly
        ? "名称收录已由官方名单与现行总数交叉核对；身份、部位、食法和专业安全资料仍待逐项审校。"
        : "官方目录身份及公告明确限制已录入；传统功效与未被公告明确支持的个体安全结论不展示。"
    }
  };
}

const ingredients = ROWS.concat(LEGACY_2002_ROWS).map(makeIngredient);
const count = ingredients.length;

module.exports = {
  schemaVersion,
  contentVersion,
  publishedAt,
  catalogCoverage,
  count,
  ingredients
};

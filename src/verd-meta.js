export const CATS = [
  ["charity", "公益站"],
  ["owner", "站长在用"],
  ["stable", "稳定企业向"],
  ["cheap", "便宜个人向"],
  ["special", "小有特色"],
  ["new", "新站上榜"],
  ["online", "当前在线"],
  ["checkin", "签到送余额"],
  ["gift", "新用户赠额"],
  ["cheaprate", "低倍率"],
  ["fast", "低延迟"],
  ["pay", "国内支付"],
  ["invite", "邀请返利"],
  ["crypto", "加密充值"],
  ["invoice", "可开发票"],
  ["highup", "高可用"],
];

export const CAT_LABEL = Object.fromEntries([
  ["all", "全部中转"],
  ...CATS,
  ["fav", "我的收藏"],
  ["other", "更多收录"],
]);

export const MODEL_FAMILIES = [
  ["gpt", "GPT / ChatGPT"],
  ["claude", "Claude"],
  ["gemini", "Gemini"],
  ["grok", "Grok"],
  ["deepseek", "DeepSeek"],
  ["kimi", "Kimi"],
  ["qwen", "Qwen"],
  ["glm", "GLM"],
  ["image", "生图"],
  ["video", "视频"],
];

export const FAMILY_MODEL_IDS = MODEL_FAMILIES.map((item) => item[0]);

export const CAT_SEO = {
  checkin: {
    h1: "签到送余额",
    title: "签到送余额API中转站推荐_每日领额度",
    desc: "支持签到送余额、每日领 Token 的 API 中转站。对照可用性和延迟，适合想少充值先试用 ChatGPT、Claude、DeepSeek 的用户。",
  },
  gift: {
    h1: "新用户赠额",
    title: "新用户赠额API中转站_注册送额度推荐",
    desc: "新用户赠额、注册送余额的 API 中转站。对照 GPT、Claude、DeepSeek 中转是否在线，方便先领额度再决定充哪家。",
  },
  cheaprate: {
    h1: "低倍率",
    title: "低倍率API中转站_便宜GPT/Claude接口",
    desc: "低倍率、便宜 GPT API 和 Claude API 中转站。按探测延迟和可用性对照，方便找更省的 ChatGPT 中转。",
  },
  fast: {
    h1: "低延迟",
    title: "低延迟API中转站_速度快的GPT接口",
    desc: "低延迟 API 中转站。看探测耗时再选 ChatGPT、Claude、DeepSeek 中转。",
  },
  pay: {
    h1: "国内支付",
    title: "国内支付API中转站_支付宝微信充值",
    desc: "支持国内支付的 API 中转站，方便用支付宝、微信给 ChatGPT、Claude 中转充值。先看探测再付款。",
  },
  invite: {
    h1: "邀请返利",
    title: "邀请返利API中转站_拉新返佣推荐",
    desc: "有邀请返利、拉新返佣的 API 中转站。先对照探测是否在线，再去对方页面看返佣规则。本站不代收充值。",
  },
  crypto: {
    h1: "加密充值",
    title: "加密充值API中转站_USDT充值接口",
    desc: "支持加密货币、USDT 充值的 API 中转站。对照可用性和延迟，充值前建议先小额测试。",
  },
  invoice: {
    h1: "可开发票",
    title: "可开发票API中转站_企业报销接口",
    desc: "可开发票的 API 中转站，方便企业对接 GPT、Claude 并报销。开票类目、税率和抬头以对方站点说明为准。",
  },
  highup: {
    h1: "高可用",
    title: "高可用API中转站_稳定GPT接口推荐",
    desc: "探测在线且可用性不低于 99.8% 的 API 中转站，适合对 ChatGPT、Claude 稳定性更敏感的用法。",
  },
  stable: {
    h1: "稳定企业向",
    title: "稳定企业向API中转站推荐",
    desc: "偏企业、对稳定性要求更高的 API 中转站。充值前请自行核实合同、售后和开票。本站不代收、不担保。",
  },
  cheap: {
    h1: "便宜个人向",
    title: "便宜个人向API中转站_低价GPT推荐",
    desc: "面向个人、价格更友好的 API 中转站。先看延迟和可用性，再小额充值实测。",
  },
  special: {
    h1: "小有特色",
    title: "有特色的API中转站_小众接口推荐",
    desc: "有特色玩法或模型组合的 API 中转站。特色、限时活动和具体模型以对方站点当前介绍为准。",
  },
  new: {
    h1: "新站上榜",
    title: "新站上榜API中转_最新收录站点",
    desc: "新收录的 API 中转站。新站探测样本少、波动可能更大，建议先看可用性，只小额测试。",
  },
  owner: {
    h1: "站长在用",
    title: "站长在用的API中转站",
    desc: "站长自己在用的 API 中转站。探测在线也不等于推荐充值，打开前先核对域名，按需小额试用。",
  },
  charity: {
    h1: "公益站对照",
    title: "公益站对照_免费API入口与使用注意",
    desc: "对照用爱发电的免费 API 入口：常见登录门槛、停更和限流风险。本站只做导航，不代收、不保证额度。",
  },
  online: {
    h1: "当前在线",
    title: "当前在线API中转站_可用GPT接口",
    desc: "当前整站探测在线的 API 中转站。在线不等于每个模型都能用，充值前仍建议对照延迟并先小额实测。",
  },
  fav: {
    h1: "我的收藏",
    title: "我收藏的API中转站",
    desc: "这台设备上收藏的 API 中转站。收藏只存在本地，不会同步到其他电脑。",
  },
};

export const CHARITY_SECTIONS = [
  {
    h: "公益站是什么",
    p: "公益站一般指个人或小团队用爱发电、对外提供免费调用额度的 API 入口。常见做法是注册送一点额度、每日签到，或用 GitHub、LinuxDo 登录后再领。它不是 OpenAI、Anthropic 的官方渠道，也很少承诺稳定性和售后。",
  },
  {
    h: "本站怎么收录",
    p: "本页只收录能核到公开入口的公益站，并对照简介里的门槛和玩法。名单会变：失效的会沉下去，新出现的会补进来。我们不代管这些站，也不保证某一天还能打开。",
  },
  {
    h: "怎么选、怎么用",
    p: "先看登录门槛和规则，再看自己能不能接受随时停服。需要 Claude Code、Codex 这类客户端的，确认对方是否真开放对应协议。额度够日常试一试就行，不要把生产任务或大量请求压上去。",
  },
  {
    h: "不适合把公益站当主力",
    p: "公益站资源有限。压测、囤号、把入口发到大群，都会把仅有的额度薅干。要稳定跑业务，应该看付费中转或官方接口，并先小额实测。本站不代收充值，也不鉴定对方模型是不是官方原厂。",
  },
];

export const CHARITY_FAQ = [
  ["公益站和普通 API 中转有什么区别？", "普通中转多是付费买额度；公益站主打免费额度。公益站更便宜，但停更、限流、改规则都更常见，适合试用，不适合当长期主力。"],
  ["这里的名单会保证能用吗？", "不会。本站只做对照导航。入口、额度、模型是否还开放，都以对方当前页面为准。"],
  ["用公益站要注意什么？", "请勿压测、勿囤号、勿把入口发到大群。本站不代收、不保管任何 API Key。"],
];

export const MODEL_SEO = {
  gpt: {
    h1: "ChatGPT / GPT API 中转站推荐",
    title: "ChatGPT中转站推荐_GPT API接口对照",
    desc: "ChatGPT 中转、GPT API、OpenAI 中转站合集。对照可用性与延迟，充值前先看模型是否还在。",
  },
  claude: {
    h1: "Claude API 中转站推荐",
    title: "Claude中转站推荐_Claude API接口对照",
    desc: "Claude 中转、Claude API 中转站列表。对照上游状态和站点延迟，方便选更稳的 Claude 接口。",
  },
  gemini: {
    h1: "Gemini API 中转站推荐",
    title: "Gemini中转站推荐_Gemini API接口",
    desc: "Gemini API、Gemini 中转站对照。看探测延迟和可用性，再决定去哪家充值。",
  },
  grok: {
    h1: "Grok API 中转站推荐",
    title: "Grok中转站推荐_Grok API接口",
    desc: "Grok API、xAI 中转站列表。对照整站可用性和延迟，充值前建议小额实测。",
  },
  deepseek: {
    h1: "DeepSeek API 中转站推荐",
    title: "DeepSeek中转站推荐_DeepSeek API对照",
    desc: "DeepSeek API、DeepSeek 中转站合集。对照延迟和可用性，适合找便宜或稳定的 DeepSeek 接口。",
  },
  kimi: {
    h1: "Kimi API 中转站推荐",
    title: "Kimi中转站推荐_月之暗面API接口",
    desc: "Kimi / 月之暗面 API 中转站对照。看探测是否在线、延迟如何，再决定去哪家充值。",
  },
  qwen: {
    h1: "Qwen / 通义千问中转站推荐",
    title: "通义千问中转站_Qwen API接口推荐",
    desc: "Qwen / 通义千问 API 中转站列表。对照可用性和延迟，具体模型以对方控制台为准。",
  },
  glm: {
    h1: "GLM / 智谱中转站推荐",
    title: "智谱GLM中转站_GLM API接口推荐",
    desc: "GLM / 智谱 API 中转站对照。看探测状态和延迟后再决定充哪家。本站不代收充值。",
  },
  image: {
    h1: "AI 生图 API 中转站推荐",
    title: "AI生图API中转站_绘图接口推荐",
    desc: "支持生图、绘图接口的 API 中转站。具体画质、计费和模型名称以对方控制台为准，建议先小额试。",
  },
  video: {
    h1: "AI 视频 API 中转站推荐",
    title: "AI视频API中转站_视频生成接口",
    desc: "支持视频生成接口的 API 中转站。充值前先看探测，并小额实测对方模型。",
  },
};

export const OFFICIAL_SEO = {
  openai: {
    h1: "OpenAI 官方状态",
    title: "OpenAI官方状态_ChatGPT模型实况",
    desc: "OpenAI 官方状态对照，看 ChatGPT、GPT 接口是否降级。上游异常时很多中转会一起受影响。",
  },
  anthropic: {
    h1: "Claude 官方状态",
    title: "Claude官方状态_Anthropic模型实况",
    desc: "Claude 官方状态对照，排查 Anthropic 接口是否异常。上游故障时第三方中转常一起受影响。",
  },
  gemini: {
    h1: "Gemini 官方状态",
    title: "Gemini官方状态_Google模型实况",
    desc: "Gemini / Google 官方状态对照，查看模型是否可用或降级。充值前建议先看本页。",
  },
  deepseek: {
    h1: "DeepSeek 官方状态",
    title: "DeepSeek官方状态_模型实况",
    desc: "DeepSeek 官方状态对照，查看 API 是否可用。本站不跳转官方后台，只做对照。",
  },
  moonshot: {
    h1: "Kimi 官方状态",
    title: "Kimi官方状态_月之暗面实况",
    desc: "Kimi / 月之暗面官方状态对照。上游异常时第三方中转常一起受影响。",
  },
  xai: {
    h1: "Grok 官方状态",
    title: "Grok官方状态_xAI模型实况",
    desc: "Grok / xAI 官方状态对照。上游降级时很多第三方中转会一起受影响。",
  },
};

export const CHECK_PAGES = {
  "": {
    h1: "模型检测",
    title: "GPT降智检测_糖果测试与鹈鹕骑车_API中转站导航",
    desc: "在浏览器里检测 API 中转有没有降智。用你自己的地址和 Key 跑基础检测、糖果测试和鹈鹕骑车。Key 不经过本站，也不能当成官方原厂鉴定。",
  },
  detect: {
    h1: "模型检测结果",
    title: "模型检测结果_中转降智与基础分_API中转站导航",
    desc: "汇总基础分、耗时、通道是否被改，以及糖果测试和鹈鹕骑车能不能判断降智。这一页不连接中转站。",
  },
  basic: {
    h1: "API 中转基础检测",
    title: "API中转基础检测_OpenAI兼容与Claude_API中转站导航",
    desc: "检测 OpenAI 兼容和 Claude Messages 的协议、流式、上下文、工具调用和用量。不支持的项跳过，不直接当成降智。",
  },
  candy: {
    h1: "糖果测试",
    title: "糖果测试_GPT降智逻辑题_API中转站导航",
    desc: "糖果测试用固定选择题看这一次 API 中转调用会不会做错逻辑题。做完给出正确率，以及迷惑辨析、数量关系、约束求解、演绎四项得分。Key 不经过本站。",
  },
  pelican: {
    h1: "鹈鹕骑车",
    title: "鹈鹕骑车_SVG动画HTML检测_API中转站导航",
    desc: "用固定提示词让模型交回 SVG 动画 HTML，页面可播放，也可下载。用来看这一次画功，不是问答题。",
  },
};

export function matchesCategory(station, cat, favs) {
  if (!cat || cat === "all") return true;
  if (cat === "fav") return Boolean(favs?.[station.slug]);
  if (cat === "online") return station.online === true;
  if (cat === "owner") {
    return Boolean(station.ownerPick) && Boolean(station.blurb) && station.online !== false
      || (station.categories || []).includes("owner");
  }
  return (station.categories || []).includes(cat);
}

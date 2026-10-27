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
    title: "签到送余额 API 中转站推荐｜每日领额度、在线率与延迟",
    desc: "支持签到送余额、每日领 Token 的 API 中转站。可对照在线率和延迟，方便少充值先试 ChatGPT、Claude、DeepSeek。额度规则以对方页面为准，本站不代领。",
  },
  gift: {
    h1: "新用户赠额",
    title: "新用户赠额 API 中转站推荐｜注册送额度与在线对照",
    desc: "新用户赠额、注册送余额的 API 中转站。可对照站点是否在线、延迟多少，再决定要不要领额度。赠额规则以对方页面为准，本站不代领。",
  },
  cheaprate: {
    h1: "低倍率",
    title: "低倍率 API 中转站推荐｜在线率与延迟对照",
    desc: "目录里归在低倍率的 GPT、Claude API 中转站。可对照探测延迟和在线率。倍率会变，充值前以对方控制台的当前价格为准。",
  },
  fast: {
    h1: "低延迟",
    title: "低延迟 API 中转站推荐｜探测耗时对照",
    desc: "目录里归在低延迟的 API 中转站。页面按探测耗时和在线率对照 ChatGPT、Claude、DeepSeek 接口。延迟会波动，下单前建议再测一次。",
  },
  pay: {
    h1: "国内支付",
    title: "国内支付 API 中转站推荐｜支付宝、微信充值与在线对照",
    desc: "目录里支持国内支付的 API 中转站，可对照在线率和延迟后再决定是否用支付宝或微信充值。支付通道以对方页面为准，本站不代收。",
  },
  invite: {
    h1: "邀请返利",
    title: "邀请返利 API 中转站推荐｜拉新返佣规则需自行核对",
    desc: "目录里标了邀请返利或拉新返佣的 API 中转站。先看探测是否在线，返佣比例、结算方式以对方页面为准。本站不代收充值，也不代结佣。",
  },
  crypto: {
    h1: "加密充值",
    title: "加密充值 API 中转站推荐｜USDT 充值与在线率、延迟对照",
    desc: "目录里支持加密货币或 USDT 充值的 API 中转站。可对照在线率和延迟。链、币种和到账规则以对方页面为准，建议先小额测试。",
  },
  invoice: {
    h1: "可开发票",
    title: "可开发票 API 中转站推荐｜企业报销前先核对开票说明",
    desc: "目录里标为可开发票的 API 中转站，方便企业对照 GPT、Claude 接口。开票类目、税率、抬头和起开金额以对方站点说明为准。",
  },
  highup: {
    h1: "高可用",
    title: "高可用 API 中转站推荐｜目录归类与在线率、延迟对照",
    desc: "目录里归在高可用的 API 中转站，可对照在线率和延迟。这个分类不是每个模型都可用的保证，充值前仍建议小额测试。",
  },
  stable: {
    h1: "稳定企业向",
    title: "稳定企业向 API 中转站推荐｜稳定性、发票和售后需自行核实",
    desc: "目录里偏企业使用的 API 中转站。可对照在线率、延迟和发票信息。合同、售后和开票以对方说明为准，本站不代收、不担保。",
  },
  cheap: {
    h1: "便宜个人向",
    title: "便宜个人向 API 中转站推荐｜价格、延迟和在线率对照",
    desc: "目录里面向个人、价格更友好的 API 中转站。先看延迟和在线率，再小额充值。标价会变，以对方控制台为准。",
  },
  special: {
    h1: "小有特色",
    title: "有特色的 API 中转站推荐｜小众模型与玩法以对方页面为准",
    desc: "目录里有特色玩法或模型组合的 API 中转站。特色、限时活动和具体模型以对方站点当前介绍为准，本站不代确认。",
  },
  new: {
    h1: "新站上榜",
    title: "新站上榜 API 中转站｜最新收录站点与在线率对照",
    desc: "新收录的 API 中转站。探测记录可能还少，在线率和延迟波动会更大。建议先看可用性，只做小额测试。",
  },
  owner: {
    h1: "站长在用",
    title: "站长在用的 API 中转站｜在用名单不等于建议充值",
    desc: "站长自己在用的 API 中转站。探测在线也不等于建议充值。打开前先核对域名，按需小额试用。本站不代收、不担保。",
  },
  charity: {
    h1: "公益站对照",
    title: "公益站对照｜免费 API 入口、停更和限流注意",
    desc: "对照用爱发电的免费 API 入口，以及常见登录门槛、停更和限流风险。本站只做导航，不代收、不保证额度，也不鉴定是不是官方原厂。",
  },
  online: {
    h1: "当前在线",
    title: "当前在线 API 中转站｜整站探测在线的接口对照",
    desc: "当前整站探测在线的 API 中转站。在线不等于每个模型、每个分组都能用。充值前仍建议对照延迟，并先小额测试。",
  },
  fav: {
    h1: "我的收藏",
    title: "我收藏的 API 中转站｜只存在这台浏览器，不会同步",
    desc: "这台浏览器上收藏的 API 中转站。收藏只写在本地，换电脑、换浏览器或清除站点数据后不会保留。",
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
    title: "ChatGPT 中转站推荐｜在线率、延迟和价格对照",
    desc: "ChatGPT 中转、GPT API、OpenAI 中转站合集。可对照在线率、延迟和价格。模型是否还在售，充值前以对方控制台为准。",
  },
  claude: {
    h1: "Claude API 中转站推荐",
    title: "Claude 中转站推荐｜在线率与延迟对照",
    desc: "Claude 中转、Claude API 中转站列表。可对照上游状态、站点在线率和延迟。接口是否稳定以你自己的调用为准，本站不担保。",
  },
  gemini: {
    h1: "Gemini API 中转站推荐",
    title: "Gemini 中转站推荐｜在线率与延迟对照",
    desc: "Gemini API、Gemini 中转站对照。可看探测延迟和在线率，再决定去哪家充值。具体模型名和价格以对方控制台为准。",
  },
  grok: {
    h1: "Grok API 中转站推荐",
    title: "Grok 中转站推荐｜在线率对照",
    desc: "Grok API、xAI 中转站列表。可对照整站在线率和延迟。充值前建议小额测试，模型是否开放以对方控制台为准。",
  },
  deepseek: {
    h1: "DeepSeek API 中转站推荐",
    title: "DeepSeek 中转站推荐｜延迟和在线率",
    desc: "DeepSeek API、DeepSeek 中转站合集。可对照延迟和在线率。价格和分组会变，充值前以对方控制台为准。",
  },
  kimi: {
    h1: "Kimi API 中转站推荐",
    title: "Kimi 中转站推荐｜在线率与延迟",
    desc: "Kimi / 月之暗面 API 中转站对照。可看探测是否在线、延迟多少，再决定去哪家充值。本站不代收。",
  },
  qwen: {
    h1: "Qwen / 通义千问中转站推荐",
    title: "通义千问中转站推荐｜在线率与延迟对照",
    desc: "Qwen / 通义千问 API 中转站列表。可对照在线率和延迟。具体模型名称和价格以对方控制台为准。",
  },
  glm: {
    h1: "GLM / 智谱中转站推荐",
    title: "智谱 GLM 中转站推荐｜在线率与延迟对照",
    desc: "GLM / 智谱 API 中转站对照。可看探测状态和延迟后再决定充哪家。本站不代收充值。",
  },
  image: {
    h1: "AI 生图 API 中转站推荐",
    title: "AI 生图 API 中转站推荐｜绘图接口、计费和在线率对照",
    desc: "目录里支持生图、绘图接口的 API 中转站。可对照在线率。画质、计费和模型名称以对方控制台为准，建议先小额测试。",
  },
  video: {
    h1: "AI 视频 API 中转站推荐",
    title: "AI 视频 API 中转站推荐｜视频生成接口与在线率对照",
    desc: "目录里支持视频生成接口的 API 中转站。充值前先看探测在线率和延迟，并小额测试对方当前模型。计费方式以对方控制台为准。",
  },
};

export const OFFICIAL_SEO = {
  openai: {
    h1: "OpenAI 官方状态",
    title: "OpenAI 官方状态对照｜接口是否降级",
    desc: "OpenAI 官方状态对照，看 ChatGPT、GPT 接口组件是否降级，以及近一段每日状态。上游异常时很多中转会一起受影响。本页不跳转官方后台。",
  },
  anthropic: {
    h1: "Claude 官方状态",
    title: "Claude 官方状态对照｜接口是否异常或降级",
    desc: "Claude 官方状态对照，查看 Anthropic 接口组件是否异常或降级。上游故障时第三方中转常一起受影响。本页不跳转官方后台。",
  },
  gemini: {
    h1: "Gemini 官方状态",
    title: "Gemini 官方状态对照｜接口是否可用或降级",
    desc: "Gemini / Google 官方状态对照，查看模型组件是否可用或降级。上游状态正常也不代表某一家中转站可用。本页不跳转官方后台。",
  },
  deepseek: {
    h1: "DeepSeek 官方状态",
    title: "DeepSeek 官方状态对照｜API 是否可用或降级",
    desc: "DeepSeek 官方状态对照，查看 API 组件是否可用或降级。本站不跳转官方后台，只做对照，也不代表第三方中转站本身可用。",
  },
  moonshot: {
    h1: "Kimi 官方状态",
    title: "Kimi 官方状态对照｜接口是否异常",
    desc: "Kimi / 月之暗面官方状态对照，查看接口组件是否异常或降级。上游异常时第三方中转常一起受影响。本页不跳转官方后台。",
  },
  xai: {
    h1: "Grok 官方状态",
    title: "Grok 官方状态对照｜接口是否降级或中断",
    desc: "Grok / xAI 官方状态对照，查看模型组件是否降级或中断。上游降级时很多第三方中转会一起受影响。本页不跳转官方后台。",
  },
};

export const CHECK_PAGES = {
  "": {
    h1: "模型检测",
    title: "维渡 AI - GPT 降智检测｜糖果测试、鹈鹕骑车与基础协议自测",
    desc: "在浏览器里检测 API 中转有没有降智。用你自己的地址和 Key 跑基础检测、糖果测试和鹈鹕骑车，对照 GPT、Claude、DeepSeek 这一次调用。Key 不经过本站，也不能当成官方原厂鉴定。",
  },
  detect: {
    h1: "模型检测结果",
    title: "维渡 AI - 模型检测结果｜基础分、耗时、糖果测试与鹈鹕骑车",
    desc: "汇总 API 中转基础分、耗时和降智判断。这一页不连接中转站，只展示已经跑过的基础检测、糖果测试和鹈鹕骑车。Key 不经过本站。",
  },
  basic: {
    h1: "API 中转基础检测",
    title: "维渡 AI - API 中转基础检测｜协议、流式、上下文与工具调用",
    desc: "检测 OpenAI 兼容接口和 Claude Messages：协议、流式、上下文、工具调用和用量。不支持的项跳过，不直接当成降智。Key 不经过本站。",
  },
  candy: {
    h1: "糖果测试",
    title: "维渡 AI - 糖果测试｜降智逻辑题、正确率与四项得分",
    desc: "糖果测试用固定选择题看这一次 API 中转调用会不会做错逻辑题。可选 5、10、15 或 20 道，做完给出正确率，以及迷惑辨析、数量关系、约束求解、演绎四项得分。Key 不经过本站。",
  },
  pelican: {
    h1: "鹈鹕骑车",
    title: "维渡 AI - 鹈鹕骑车｜SVG 动画 HTML 画功检测与播放",
    desc: "鹈鹕骑车用固定提示词让模型交回 SVG 动画 HTML，跑完可以播放和下载。用来看这一次画功，不是问答题，也不能当成官方原厂鉴定。Key 不经过本站。",
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

# 广告统计与 AI 过滤

2026-11-11 更新。前端与后端一并发布才会启用新的页面和入口归因。

- 全部：所有收到并通过格式和投放期校验的事件。包含已识别 AI、其他自动化、缺失 UA 及历史计数。
- 过滤后：服务端没有命中 AI / 自动化规则，UA 非缺失，且浏览器没有上报 webdriver。不是确定的真人，也不是独立访客 UV。
- AI：已知 AI UA 名称命中，包括用户主动发起的网页检索代理。这些是 AI 访问，不是直接浏览网页的真人。
- 历史 / 未知：旧广告日计数一次性迁入、保留原数，没有虚构来源或真人标记。

曝光为前台页面 50% 可见持续 1 秒。同一路由访问内每广告、入口一次。点击为事件次数，浏览器请求 ID 在服务端去重（90 天）。广告跳转 `/go/:id` 只由跳转接口计数；自然目录使用独立事件并匹配已投广告的目标域名。站内详情和官网外链分开展示，不改变原链接目的地。不同广告使用同一域名时分别归因到对应投放，跨广告的合计不是去重访客数。

只保存广告 ID、北京时间日期、去除查询参数的页面路径、位置、入口类型、分类结果、规则名和聚合数量；不存原始 IP、UA、密钥和访客 ID。去重事件编号是单事件随机数，不用于跨页识别访客。曝光依赖浏览器上报，未执行脚本的抓取不算“可见曝光”；全部不是完整服务器访问日志。匿名客户端事件可以伪造，适合运营分析，不是经过反作弊认证的计费依据。

共享识别 `server/traffic_identity.py` 给广告、流量与访客模块使用。UA 仅为声明，未实施官方 IP 验证或浏览器指纹。真人通过 AI 来源链接打开普通浏览器仍计入过滤后流量。新规则只作用新事件；历史访客与流量记录不重新推断。

官方依据（当日实际读取）：

- OpenAI: https://developers.openai.com/api/docs/bots （GPTBot / OAI-SearchBot / ChatGPT-User，用途各不相同，官方发布 IP 范围）
- Anthropic: https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler （ClaudeBot / Claude-SearchBot / Claude-User）
- Perplexity: https://docs.perplexity.ai/docs/resources/perplexity-crawlers （PerplexityBot / Perplexity-User）

验收：`python -m unittest discover -s server -p test_ad_analytics.py`、`python -m unittest discover -s server -p test_ops.py`、前后台构建，并用隔离数据检查后台布局和前端可见性 / 点击回报。迁移不删原 ad_daily，旧编辑页计数仍是累计广告位原始数据，新的列表入口单独在分析里统计。

流量页交互回归：`node scripts/traffic-ui.test.mjs`，需要可用的 Playwright 与 Chromium；已有独立安装时以 `PLAYWRIGHT_MODULE` 指向其 `index.mjs`。测试默认连接 `http://127.0.0.1:5180`，所有 API 响应均在独立测试浏览器内替换为样例，不修改真实广告或统计数据。验证展示类型连续展开与选中、广告与日期筛选、页面归因切换、逐日明细、错误恢复及 1600 / 760 / 390px 布局；截图默认保存到 `previews/traffic`，可通过 `TRAFFIC_QA_OUTPUT` 调整。

筛选组件使用普通容器加 `aria-labelledby`，不得再使用原生 `label` 包裹 Arco 下拉框或日期选择器：原生标签转发点击会使菜单打开后立即关闭。逐日明细默认收起，按日期倒序，支持仅显示非零日期，最大高度内滚动；右侧流量构成不随左侧明细拉伸。统计说明保留为独立的四项展开区。

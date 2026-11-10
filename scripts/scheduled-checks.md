# 三站自动检测

## 线上运行

生产服务器使用 `server/systemd/veridrop-checks.service` 和 `veridrop-checks.timer`。服务器时区为 UTC，计时器每天 01:00 UTC（北京时间 09:00）启动。开启 `Persistent=true`，停机错过时间会在恢复后补跑；同日去重和运行锁继续由原有运行器负责。部署时须确认服务器时区为 UTC。

线上名单仍为 `data/basic-daily.json` 三站，密钥由 root 专用 `/etc/veridrop/scheduled-checks.env` 加载（目录700、文件600），不放入代码、日志、前端或部署包。Python 解释器通过 `PYTHON` 指定为 `/opt/python311/bin/python3`。检查配置使用同一服务环境运行 `node scripts/check-schedule.mjs --dry-run`；检查状态使用 `systemctl list-timers veridrop-checks.timer` 和 `journalctl -u veridrop-checks.service`。

从本机迁移时合并公开基础报告索引、复制完整分享报告并迁移去重记录，保留线上已有报告；不重复执行当天测试。线上服务验证通过后停用原 Codex 本机任务，避免两处同时扣费。

首页“最近实测”通过 `/api/basic-reports?recent=1` 读取新报告，与历史记录按站点合并，每站保留最新时间。站点详情沿用现有基础报告接口。定时执行无需重建前端；分数、题库和评分规则沿用现有运行器。

以下为保留的本机运行方式。

运行入口：`node scripts/run-scheduled-checks.mjs`。
先验证配置和凭据加载（不请求模型）：加 `--dry-run`。仅执行当日基础检查：加 `--basic-only`。

名单在本机 `data/basic-daily.json`；密钥在 `data/check-keys.local`，由 Windows 当前账户 DPAPI 加密，两者均被 Git 忽略。换电脑、Windows 账户或服务器后，需要重新配置密钥。不要把密钥写进自动任务提示词。

默认模型为 gpt-6-astra，糖果题量为 10 题。基础测试继续使用原有运行器和评分；三项全测使用同一题库、提示词和评分，再加糖果测试和鹈鹕骑车。不会执行生成 HTML 的代码。

每日任务按北京时间日期去重。第一次定时运行全测，之后距上次完整全测满 3 天再全测；其他日期仅基础测试。全测当日的基础测试就是当天的基础记录，不再另跑一遍。错题或不通过会如实保存；网络、配额等导致全测不完整时，下一天再尝试。同一天失败不会循环重试。

基础报告保存到 `data/basic-reports`，站点详情会读取该目录；完整报告通过现有分享存储保存到 `data/shared-reports`。每站最新状态、基础报告地址和全测分享地址保存在 `data/check-schedule.local`。这些都是本机数据，不会自动上传到线上。

运行中使用 `data/check-schedule-lock.local` 防止并发重复扣费。如果电脑重启等导致残留，先核对锁中 PID 对应进程已经结束，再移除该锁。不要在旧进程还在运行时移除。

Codex 每天 09:00 的任务运行上述入口。执行时需保持电脑开机并运行 Codex；关闭电脑或应用不会由服务器代跑。任务不发布或部署网站，不改前端、SEO 或评分规则。

验证：`node --test scripts/check-schedule.test.mjs`，包含北京时间换日、每 3 天边界、同日去重、原题库评分、流式 HTML 保留与配额失败脱敏。

"""Shared, conservative traffic classification. UA matches are claims, not proof."""
import re

AI_AGENTS = re.compile(r"GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|CCBot|Bytespider|cohere-ai|cohere-training-data-crawler|meta-externalagent|meta-externalfetcher|Amazonbot|Google-Extended|Diffbot|YouBot", re.I)
AUTOMATION = re.compile(r"google-inspectiontool|ahrefs|semrush|yandex|sogou|bot|spider|crawl|slurp|headless|curl[ /]|wget[ /]|python[- /]|httpclient|go-http-client|scrapy|selenium|playwright|puppeteer|local-mirror", re.I)


def classify(agent="", automated=False):
    text = str(agent or "").strip()[:1000]
    match = AI_AGENTS.search(text)
    if match:
        return "ai", match.group(0).lower()
    if automated is True or str(automated) == "1":
        return "bot", "webdriver"
    match = AUTOMATION.search(text)
    if match:
        return "bot", match.group(0).lower().strip()
    if not text or (len(text) < 12 and not text.startswith("Mozilla/")):
        return "unknown", "missing-user-agent"
    return "human", "unflagged-browser"

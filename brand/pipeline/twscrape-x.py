#!/usr/bin/env python3
"""Pipeline CLI: JSONL search/replies using a private twscrape account pool."""
import argparse
import asyncio
from contextlib import aclosing
import os
from pathlib import Path
import sys

from twscrape import API
from twscrape.logger import logger, set_log_level


reported_statuses = set()


def report_status(message):
    # Library messages can include account names or response details. Emit only labels.
    text = message.record["message"]
    labels = {
        "Rate limited:": "rate-limited",
        'No account available for queue "': "waiting-account",
        "Session expired or banned:": "authentication-rejected",
        "Ban detected:": "account-rejected",
        "Blocked by Cloudflare:": "blocked-cloudflare",
        "Blocked by HTML:": "blocked-html",
        "API busy:": "api-busy",
        "Unhandled API response code:": "http-error",
        "[DEV] Update required:": "request-features-outdated",
        "Unknown error. Account timeouted for 15 minutes.": "unexpected-response",
    }
    status = next((label for prefix, label in labels.items() if text.startswith(prefix)), None)
    if "Missing authentication cookies" in text:
        status = "missing-authentication-cookies"
    elif "cooling account for 60s" in text:
        status = "transport-failure"
    if status == "unexpected-response":
        detail = text.partition("Err: ")[2].split(";", 1)[0].split(":", 1)[0]
        if detail in ("IndexError", "KeyError", "TypeError", "ValueError", "AttributeError", "ImportError", "RuntimeError", "JSONDecodeError"):
            status += f"/{detail}"
        elif detail.startswith("HttpStatusError "):
            code = detail.removeprefix("HttpStatusError ")
            if code.isascii() and code.isdigit() and 100 <= int(code) <= 599:
                status += f"/http-{int(code)}"
    if status and status not in reported_statuses:
        reported_statuses.add(status)
        print(f"twscrape-x status: {status}", file=sys.stderr, flush=True)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["search", "tweet_replies"])
    parser.add_argument("query")
    parser.add_argument("--limit", type=int, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    set_log_level("CRITICAL")
    logger.add(report_status, level="DEBUG", filter=lambda record: (record["name"] or "").startswith("twscrape."))
    db = Path(os.environ.get("TWSCRAPE_DB", "~/.config/dianran/twscrape/accounts.db")).expanduser()
    db.parent.mkdir(parents=True, exist_ok=True)
    # Match the existing parent-process search/reply deadlines when the pool is rate-limited.
    api = API(str(db), raise_when_no_account=True, wait_timeout=20 * 60 if args.command == "search" else 5 * 60)
    cookies = os.environ.get("TWITTER_COOKIES")
    if cookies:
        await api.pool.add_account_cookies("maintainer", cookies)
    stream = api.search(args.query, limit=args.limit) if args.command == "search" else api.tweet_replies(int(args.query), limit=args.limit)
    async with aclosing(stream):
        count = 0
        async for tweet in stream:
            print(tweet.json(), flush=True)
            count += 1
            if count >= args.limit:
                break


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        # Never print session data, HTTP headers or cookie-bearing exception details.
        print(f"twscrape-x failed: {type(error).__name__}; check X login/account availability", file=sys.stderr)
        sys.exit(1)

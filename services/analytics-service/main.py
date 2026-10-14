import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime

import aio_pika
import asyncpg
from fastapi import FastAPI

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("analytics-service")

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://app:devpassword@localhost:5672/")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:devpassword@localhost:5433/analytics")
QUEUE = "click_events"

state = {"pool": None, "conn": None}


async def handle_message(message: aio_pika.IncomingMessage):
    # Message is acked on success; on an unexpected error (e.g. DB down) it is requeued
    async with message.process(requeue=True):
        try:
            event = json.loads(message.body)
            ts = datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00"))
            code = event["shortCode"]
        except (ValueError, KeyError) as e:
            # Malformed event: retrying will never fix it, so drop it
            log.error("dropping malformed event: %s", e)
            return

        await state["pool"].execute(
            "INSERT INTO clicks (time, short_code, user_agent, referer, ip) "
            "VALUES ($1, $2, $3, $4, $5)",
            ts, code, event.get("userAgent"), event.get("referer"), event.get("ip"),
        )


async def start_consumer():
    # connect_robust auto-reconnects later; this loop covers the *initial* connect
    while True:
        try:
            conn = await aio_pika.connect_robust(RABBITMQ_URL)
            channel = await conn.channel()
            await channel.set_qos(prefetch_count=10)
            queue = await channel.declare_queue(QUEUE, durable=True)
            await queue.consume(handle_message)
            state["conn"] = conn
            log.info("consuming from queue '%s'", QUEUE)
            return
        except Exception as e:
            log.warning("rabbitmq not ready (%s), retrying in 5s", e)
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    state["pool"] = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    task = asyncio.create_task(start_consumer())
    yield
    task.cancel()
    if state["conn"]:
        await state["conn"].close()
    await state["pool"].close()


app = FastAPI(title="analytics-service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "analytics-service"}


@app.get("/stats/{short_code}")
async def stats(short_code: str, hours: int = 24):
    pool = state["pool"]

    total = await pool.fetchval(
        "SELECT count(*) FROM clicks WHERE short_code = $1", short_code
    )
    buckets = await pool.fetch(
        """
        SELECT time_bucket('1 hour', time) AS bucket, count(*) AS clicks
        FROM clicks
        WHERE short_code = $1 AND time > now() - make_interval(hours => $2)
        GROUP BY bucket ORDER BY bucket
        """,
        short_code, hours,
    )
    referers = await pool.fetch(
        """
        SELECT COALESCE(referer, 'direct') AS referer, count(*) AS clicks
        FROM clicks WHERE short_code = $1
        GROUP BY 1 ORDER BY clicks DESC LIMIT 5
        """,
        short_code,
    )

    return {
        "shortCode": short_code,
        "totalClicks": total,
        "clicksPerHour": [
            {"hour": r["bucket"].isoformat(), "clicks": r["clicks"]} for r in buckets
        ],
        "topReferers": [dict(r) for r in referers],
    }
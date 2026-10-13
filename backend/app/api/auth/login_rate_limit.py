from collections import OrderedDict, deque
from hashlib import sha256
from ipaddress import ip_address, ip_network
from math import ceil
from threading import Lock
from time import monotonic
from typing import Callable
from uuid import uuid4

from fastapi import Request
from redis import Redis

from app.core.config import RATE_LIMIT_REDIS_URL


class LoginAttemptLimiter:
    def __init__(
        self,
        *,
        max_attempts: int = 5,
        window_seconds: int = 15 * 60,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._clock = clock
        self._attempts: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = Lock()

    def retry_after(self, key: str) -> int | None:
        now = self._clock()
        with self._lock:
            attempts = self._attempts.get(key)
            if attempts is None:
                return None

            self._discard_expired(attempts, now)
            if not attempts:
                del self._attempts[key]
                return None

            self._attempts.move_to_end(key)
            if len(attempts) < self.max_attempts:
                return None

            return max(1, ceil(self.window_seconds - (now - attempts[0])))

    def record_failure(self, key: str) -> None:
        now = self._clock()
        with self._lock:
            attempts = self._attempts.get(key)
            if attempts is None:
                attempts = deque()
                self._attempts[key] = attempts
            else:
                self._discard_expired(attempts, now)
                self._attempts.move_to_end(key)

            if len(attempts) < self.max_attempts:
                attempts.append(now)

            while len(self._attempts) > 10_000:
                self._attempts.popitem(last=False)

    def clear(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)

    def _discard_expired(self, attempts: deque[float], now: float) -> None:
        while attempts and now - attempts[0] >= self.window_seconds:
            attempts.popleft()


class RedisLoginAttemptLimiter:
    _RETRY_AFTER_SCRIPT = """
    local key = KEYS[1]
    local redis_time = redis.call('TIME')
    local now = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
    local window = tonumber(ARGV[1])
    local max_attempts = tonumber(ARGV[2])
    redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
    local count = redis.call('ZCARD', key)
    if count < max_attempts then
      return 0
    end
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    redis.call('EXPIRE', key, math.ceil(window / 1000))
    return math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))
    """

    _RECORD_FAILURE_SCRIPT = """
    local key = KEYS[1]
    local redis_time = redis.call('TIME')
    local now = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
    local window = tonumber(ARGV[1])
    local max_attempts = tonumber(ARGV[2])
    local member = ARGV[3]
    redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
    if redis.call('ZCARD', key) < max_attempts then
      redis.call('ZADD', key, now, member)
    end
    redis.call('EXPIRE', key, math.ceil(window / 1000))
    return 1
    """

    def __init__(
        self,
        client: Redis,
        *,
        max_attempts: int = 5,
        window_seconds: int = 15 * 60,
    ) -> None:
        self._client = client
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds

    def retry_after(self, key: str) -> int | None:
        retry_after = self._client.eval(
            self._RETRY_AFTER_SCRIPT,
            1,
            self._redis_key(key),
            self.window_seconds * 1000,
            self.max_attempts,
        )
        return int(retry_after) or None

    def record_failure(self, key: str) -> None:
        self._client.eval(
            self._RECORD_FAILURE_SCRIPT,
            1,
            self._redis_key(key),
            self.window_seconds * 1000,
            self.max_attempts,
            uuid4().hex,
        )

    def clear(self, key: str) -> None:
        self._client.delete(self._redis_key(key))

    def check_connection(self) -> None:
        self._client.ping()

    @staticmethod
    def _redis_key(key: str) -> str:
        return f"login-failures:{sha256(key.encode()).hexdigest()}"


def get_client_ip(request: Request, trusted_proxy_hosts: tuple[str, ...] = ()) -> str:
    peer = request.client.host if request.client else "unknown"
    if not trusted_proxy_hosts:
        return peer

    try:
        peer_address = ip_address(peer)
        trusted_networks = tuple(
            ip_network(network, strict=False) for network in trusted_proxy_hosts
        )
    except ValueError:
        return peer

    if not any(
        peer_address.version == network.version and peer_address in network
        for network in trusted_networks
    ):
        return peer

    forwarded_for = request.headers.get("x-forwarded-for")
    if not forwarded_for:
        return peer

    try:
        chain = [ip_address(value.strip()) for value in forwarded_for.split(",")]
    except ValueError:
        return peer

    for address in reversed(chain):
        if not any(
            address.version == network.version and address in network
            for network in trusted_networks
        ):
            return str(address)

    return str(chain[0]) if chain else peer


login_attempt_limiter = (
    RedisLoginAttemptLimiter(
        Redis.from_url(
            RATE_LIMIT_REDIS_URL,
            socket_connect_timeout=5,
            socket_timeout=5,
        )
    )
    if RATE_LIMIT_REDIS_URL
    else LoginAttemptLimiter()
)

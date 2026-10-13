from collections import OrderedDict, deque
from math import ceil
from threading import Lock
from time import monotonic
from typing import Callable


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


login_attempt_limiter = LoginAttemptLimiter()

"""Bounded, thread-safe attempt limits for the single-process local server.

Multi-worker deployments require a shared limiter at the gateway or datastore.
Restarting the process clears this local limit; this is not a permanent lockout.
"""
import hashlib
import math
import threading
import time
from fastapi import HTTPException


class AttemptLimiter:
    def __init__(self, attempts=10, window=60, capacity=10000, clock=time.monotonic):
        self.attempts, self.window, self.capacity = attempts, window, capacity
        self.clock = clock
        self.entries = {}
        self.lock = threading.Lock()

    def consume(self, identity):
        key = hashlib.sha256(str(identity).encode('utf-8')).digest()
        with self.lock:
            now = self.clock()
            count, expires = self.entries.get(key, (0, now+self.window))
            if expires <= now:
                count, expires = 0, now+self.window
            if key not in self.entries and len(self.entries) >= self.capacity:
                self.entries = {k: v for k, v in self.entries.items() if v[1] > now}
                if len(self.entries) >= self.capacity:
                    self._reject(self.window)
            if count >= self.attempts:
                self._reject(expires-now)
            self.entries[key] = (count+1, expires)

    @staticmethod
    def _reject(seconds):
        raise HTTPException(429, 'Too many authentication attempts. Please try again later.',
                            headers={'Retry-After': str(max(1, math.ceil(seconds)))})


auth_attempts = AttemptLimiter()
source_attempts = AttemptLimiter(attempts=60)

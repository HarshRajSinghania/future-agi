"""Bounded typed requests to TypeSafe's System One API with the org's own key."""

import random
import threading
import time
from functools import lru_cache

from django.conf import settings

from ee.jev.mapping import JevMappingError, check_input_size
from tfc.ee_gates import is_jev_model

TYPESAFE_BASE_URL = "https://api.typesafe.ai"
_MAX_RESPONSE_BYTES = 10 * 1024 * 1024


class JevGatewayError(RuntimeError):
    def __init__(self, code="JEV_PROVIDER_ERROR", retryable=False, retry_after=None):
        self.code, self.retryable, self.retry_after = code, retryable, retry_after
        super().__init__(code)


@lru_cache(maxsize=1)
def _semaphore(limit):
    return threading.BoundedSemaphore(limit)


def _provider_error(status, retry_after=None):
    """Map a TypeSafe HTTP status to a typed, body-free error."""
    if status in (401, 403):
        # The org's key was rejected; retrying cannot help.
        return JevGatewayError("JEV_KEY_INVALID")
    if status == 429:
        return JevGatewayError("JEV_RATE_LIMITED", True, retry_after)
    if status in (408, 504):
        return JevGatewayError("JEV_TIMEOUT", True, retry_after)
    return JevGatewayError("JEV_PROVIDER_ERROR", status in (500, 502, 503), retry_after)


class JevSystemOneClient:
    def __init__(
        self, *, api_key=None, sleep=time.sleep, clock=time.monotonic, jitter=None
    ):
        self.api_key = api_key
        self.sleep, self.clock = sleep, clock
        self.jitter = jitter or (lambda upper: random.uniform(0, upper))
        self.attempt = 0
        self.attempts = []

    def _request(self, payload, timeout):
        import httpx

        if not self.api_key:
            raise JevGatewayError("JEV_KEY_MISSING")
        base_url = getattr(settings, "TYPESAFE_BASE_URL", "") or TYPESAFE_BASE_URL
        try:
            response = httpx.post(
                base_url.rstrip("/") + "/v1/systemone",
                json=payload,
                timeout=timeout,
                follow_redirects=False,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
            )
        except httpx.TimeoutException:
            raise JevGatewayError("JEV_TIMEOUT", True) from None
        except httpx.HTTPError:
            raise JevGatewayError("JEV_PROVIDER_ERROR", True) from None
        if response.status_code != 200:
            raise _provider_error(
                response.status_code, response.headers.get("Retry-After")
            )
        if len(response.content) > _MAX_RESPONSE_BYTES:
            raise JevGatewayError()
        return response.json()

    def evaluate(self, model, state, questions, *, timeout=35):
        if not is_jev_model(model):
            raise JevMappingError(
                "JEV_MODEL_UNKNOWN", "model", "Unsupported Jev model."
            )
        payload = {"model": model, "state": state, "questions": questions}
        check_input_size(payload)
        self.attempt, self.attempts = 0, []
        deadline = self.clock() + min(getattr(settings, "JEV_TOTAL_DEADLINE", 90), 90)
        semaphore = _semaphore(max(1, int(getattr(settings, "JEV_MAX_CONCURRENT", 8))))
        if not semaphore.acquire(timeout=max(0, deadline - self.clock())):
            raise JevGatewayError("JEV_TIMEOUT", True)
        try:
            for attempt in range(
                1, min(int(getattr(settings, "JEV_MAX_RETRIES", 2)), 2) + 2
            ):
                remaining = deadline - self.clock()
                if remaining <= 0:
                    raise JevGatewayError("JEV_TIMEOUT", True)
                self.attempt = attempt
                try:
                    response = self._request(payload, min(timeout, remaining))
                    if not isinstance(response, dict):
                        raise JevGatewayError()
                    if "error" in response:
                        raise JevGatewayError()
                    if self.clock() > deadline:
                        raise JevGatewayError("JEV_TIMEOUT", True)
                    # Only allowlisted accounting fields are retained; never the body.
                    self.attempts.append(
                        {
                            "attempt": attempt,
                            "outcome": "success",
                            "usage": response.get("usage", {}),
                        }
                    )
                    return response
                except JevGatewayError as exc:
                    error = exc
                except (ValueError, TypeError):
                    error = JevGatewayError()
                self.attempts.append(
                    {
                        "attempt": attempt,
                        "outcome": "error",
                        "usage": {},
                        "code": error.code,
                    }
                )
                if (
                    not error.retryable
                    or attempt
                    >= min(int(getattr(settings, "JEV_MAX_RETRIES", 2)), 2) + 1
                ):
                    raise error from None
                delay = self.jitter(2 ** (attempt - 1))
                try:
                    retry_after = float(error.retry_after)
                    if 0 <= retry_after <= 10:
                        delay = retry_after
                except (TypeError, ValueError):
                    pass
                if self.clock() + delay >= deadline:
                    raise JevGatewayError("JEV_TIMEOUT", True) from None
                self.sleep(delay)
            raise JevGatewayError()
        finally:
            semaphore.release()

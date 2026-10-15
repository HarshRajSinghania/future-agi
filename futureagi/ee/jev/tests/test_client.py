"""R-05, R-06, R-15..R-17: org-key transport, bounded retries, no fallback."""

from unittest.mock import Mock, patch

import httpx
import pytest
from django.test import override_settings

from ee.jev.client import JevGatewayError, JevSystemOneClient
from ee.jev.mapping import JevMappingError
from ee.licensing.managed_ai import is_managed_model

pytestmark = pytest.mark.requires_ee
ORG_KEY = "org-typesafe-key-CANARY"
OK = {
    "model": "jev-1.13.0",
    "answers": {"q1": {"type": "noul", "noul": 0.9}},
    "usage": {"input_tokens": 412, "output_tokens": 6},
}
QUESTIONS = {"q1": {"type": "noul", "instructions": "Judge"}}


def client(**kwargs):
    return JevSystemOneClient(api_key=ORG_KEY, **kwargs)


def reply(status, code=None, headers=None):
    return httpx.Response(
        status,
        json={"error": {"code": code, "message": "PRIVATE-CANARY"}} if code else OK,
        headers=headers,
    )


def test_r05_calls_typesafe_with_the_org_key():
    with patch("httpx.post", return_value=reply(200)) as post:
        result = client().evaluate(
            "jev-latest", {"input": "value"}, QUESTIONS, timeout=35
        )
    assert result == OK
    assert post.call_args.args == ("https://api.typesafe.ai/v1/systemone",)
    assert post.call_args.kwargs["json"] == {
        "model": "jev-latest",
        "state": {"input": "value"},
        "questions": QUESTIONS,
    }
    assert post.call_args.kwargs["headers"]["Authorization"] == f"Bearer {ORG_KEY}"
    assert post.call_args.kwargs["follow_redirects"] is False


@override_settings(TYPESAFE_BASE_URL="https://typesafe.example/")
def test_r05_base_url_setting():
    with patch("httpx.post", return_value=reply(200)) as post:
        client().evaluate("jev-latest", "x", QUESTIONS, timeout=35)
    assert post.call_args.args == ("https://typesafe.example/v1/systemone",)


def test_missing_org_key_never_calls_out():
    with (
        patch("httpx.post") as post,
        pytest.raises(JevGatewayError, match="JEV_KEY_MISSING") as error,
    ):
        JevSystemOneClient().evaluate("jev-latest", "x", QUESTIONS, timeout=35)
    assert not error.value.retryable
    post.assert_not_called()


@pytest.mark.parametrize("status", [401, 403])
def test_rejected_org_key_is_not_retried(status):
    sleep = Mock()
    with patch("httpx.post", return_value=reply(status, "invalid_api_key")) as post:
        with pytest.raises(JevGatewayError, match="JEV_KEY_INVALID") as error:
            client(sleep=sleep).evaluate("jev-latest", "x", QUESTIONS, timeout=35)
    assert ORG_KEY not in str(error.value)
    assert post.call_count == 1
    sleep.assert_not_called()


@pytest.mark.parametrize(
    "model", ["jev-preview", "jev-2.0.0", "JEV-LATEST", "turing_large"]
)
def test_r06_unknown_model_zero_transport(model):
    with (
        patch("httpx.post") as post,
        pytest.raises(JevMappingError, match="JEV_MODEL_UNKNOWN"),
    ):
        client().evaluate(model, "x", QUESTIONS, timeout=35)
    post.assert_not_called()


@pytest.mark.parametrize(
    "status,code",
    [
        (400, "upstream_rejected"),
        (402, "payment_required"),
        (404, "model_not_found"),
        (413, "request_too_large"),
        (422, "invalid_question"),
        (501, "not_supported"),
    ],
)
def test_r15_r16_no_retry_or_content_leak(status, code):
    sleep = Mock()
    with patch("httpx.post", return_value=reply(status, code)) as post:
        with pytest.raises(JevGatewayError, match="JEV_PROVIDER_ERROR") as error:
            client(sleep=sleep).evaluate(
                "jev-latest", "PRIVATE-CANARY", QUESTIONS, timeout=35
            )
    assert not error.value.retryable
    assert "PRIVATE-CANARY" not in str(error.value)
    assert post.call_count == 1
    sleep.assert_not_called()


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_r16_transient_retry_success(status):
    sleep = Mock()
    with patch(
        "httpx.post",
        side_effect=[reply(status, "busy", {"Retry-After": "2"}), reply(200)],
    ) as post:
        jev = client(sleep=sleep)
        assert jev.evaluate("jev-latest", "x", QUESTIONS, timeout=35) == OK
    assert post.call_count == 2
    sleep.assert_called_once_with(2)
    assert jev.attempt == 2
    assert jev.attempts[0]["outcome"] == "error"
    assert jev.attempts[1]["usage"]["output_tokens"] == 6


def test_r16_retry_exhaustion_and_bounded_jitter():
    sleep = Mock()
    with patch(
        "httpx.post",
        return_value=reply(429, "rate_limit_exceeded", {"Retry-After": "11"}),
    ) as post:
        with pytest.raises(JevGatewayError, match="JEV_RATE_LIMITED"):
            client(sleep=sleep, jitter=lambda upper: upper).evaluate(
                "jev-latest", "x", QUESTIONS, timeout=35
            )
    assert post.call_count == 3
    assert [call.args[0] for call in sleep.call_args_list] == [1, 2]


@pytest.mark.parametrize(
    "error",
    [httpx.ConnectError("PRIVATE-CANARY"), httpx.TimeoutException("PRIVATE-CANARY")],
)
def test_r16_transport_retries(error):
    with patch("httpx.post", side_effect=[error, reply(200)]) as post:
        assert (
            client(sleep=Mock()).evaluate("jev-latest", "x", QUESTIONS, timeout=35)
            == OK
        )
    assert post.call_count == 2


def test_r16_total_deadline_and_cancel():
    now = [0.0]

    def delayed(*args, **kwargs):
        assert kwargs["timeout"] <= 35
        now[0] += kwargs["timeout"]
        raise httpx.TimeoutException("slow")

    with patch("httpx.post", side_effect=delayed) as post:
        with pytest.raises(JevGatewayError, match="JEV_TIMEOUT"):
            client(
                clock=lambda: now[0],
                sleep=lambda delay: now.__setitem__(0, now[0] + delay),
                jitter=lambda _: 0,
            ).evaluate("jev-latest", "x", QUESTIONS, timeout=35)
    assert now[0] == 90
    assert post.call_count == 3
    with (
        patch("httpx.post", side_effect=KeyboardInterrupt) as post,
        pytest.raises(KeyboardInterrupt),
    ):
        client(sleep=Mock()).evaluate("jev-latest", "x", QUESTIONS, timeout=35)
    assert post.call_count == 1


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"PRIVATE-CANARY"),
        httpx.Response(200, json={"error": {"message": "PRIVATE-CANARY"}}),
    ],
)
def test_r12_malformed_or_error_body_is_sanitized_error(response):
    with patch("httpx.post", return_value=response) as post:
        with pytest.raises(JevGatewayError, match="JEV_PROVIDER_ERROR") as error:
            client(sleep=Mock()).evaluate("jev-latest", "x", QUESTIONS, timeout=35)
    assert "PRIVATE-CANARY" not in str(error.value)
    assert post.call_count == 1


@pytest.mark.parametrize("model", ["jev-latest", "jev-1.13.0"])
def test_jev_is_not_a_futureagi_managed_model(model):
    # Third-party models are bring your own key; only Turing models run on
    # FutureAGI credentials, so Jev must never route through the managed gateway.
    assert not is_managed_model(model)


def test_r16_concurrency_bound():
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from time import sleep

    lock = threading.Lock()
    active = 0
    maximum = 0

    def dispatch(*args, **kwargs):
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(active, maximum)
        sleep(0.02)
        with lock:
            active -= 1
        return reply(200)

    with (
        patch("httpx.post", side_effect=dispatch),
        ThreadPoolExecutor(max_workers=20) as pool,
    ):
        results = list(
            pool.map(
                lambda _: client().evaluate("jev-latest", "x", QUESTIONS, timeout=35),
                range(20),
            )
        )
    assert len(results) == 20
    assert 1 <= maximum <= 8

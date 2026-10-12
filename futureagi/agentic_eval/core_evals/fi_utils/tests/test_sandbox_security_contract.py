import importlib.util
import sys
import urllib.error
from email.message import Message
from io import BytesIO
from pathlib import Path

from agentic_eval.core_evals.fi_utils import sandbox


def test_fallback_safe_modules_exclude_pandas_and_jinja2():
    assert "pandas" not in sandbox.SAFE_MODULES
    assert "jinja2" not in sandbox.SAFE_MODULES


def test_executor_token_is_required_before_calling_execute(monkeypatch):
    monkeypatch.delenv("INTERNAL_SERVICE_TOKEN", raising=False)
    called = False

    def fail(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("executor was called without a token")

    monkeypatch.setattr(sandbox.urllib.request, "urlopen", fail)

    result = sandbox._call_executor_service("return 1", {}, "python", 1)

    assert result == {
        "status": "error",
        "data": sandbox.EXECUTOR_UNAVAILABLE_MESSAGE,
        "setup_error": True,
    }
    assert called is False


def test_executor_401_does_not_fall_back_locally(monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "test-service-token")
    monkeypatch.setattr(
        sandbox.urllib.request,
        "urlopen",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            urllib.error.HTTPError(
                sandbox.CODE_EXECUTOR_URL,
                401,
                "unauthorized",
                Message(),
                BytesIO(),
            )
        ),
    )

    result = sandbox._call_executor_service("return 1", {}, "python", 1)

    assert result == {
        "status": "error",
        "data": sandbox.EXECUTOR_UNAVAILABLE_MESSAGE,
        "setup_error": True,
    }


def test_local_javascript_argv_uses_node_permission_for_only_the_script(
    monkeypatch,
):
    monkeypatch.setattr(
        sandbox,
        "_call_executor_service",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(sandbox, "_local_fallback_allowed", lambda language: True)
    monkeypatch.setattr(sandbox.os.path, "isfile", lambda path: True)
    captured = {}

    def capture(argv, script, suffix, timeout, address_space_mb):
        captured["argv"] = argv("/tmp/eval.js") if callable(argv) else argv
        return {"status": "success", "data": True}

    monkeypatch.setattr(sandbox, "_run_contained", capture)

    sandbox.execute_sandboxed_javascript("function evaluate() {}", {}, timeout=1)

    assert "--permission" in captured["argv"]
    assert "--allow-fs-read=/tmp/eval.js" in captured["argv"]


def test_nsjail_binds_only_required_read_paths():
    server_path = Path(__file__).parents[4] / "code-executor" / "server.py"
    spec = importlib.util.spec_from_file_location("code_executor_server_argv_test", server_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    assert module._nsjail_read_only_binds(
        "/usr/local/bin/python",
        "/sandbox/scripts/eval.py",
    ) == [
        "-R",
        "/usr/local",
        "-R",
        "/sandbox/scripts",
        "-R",
        "/dev/null",
        "-R",
        "/dev/urandom",
    ]

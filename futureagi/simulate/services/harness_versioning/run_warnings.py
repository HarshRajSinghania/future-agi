"""What a run of the picked versions should be warned about, read without writing.

Warnings never block a run. They come in a fixed order: the suite, the agent, then the
bundle. A failed cache row reads as failed rather than as a miss: the run that meets it
prepares it again. Cache warnings concern only a run that prepares its bundle; one of the
defaults without a cached bundle runs as before.
"""

from __future__ import annotations

from typing import Any

from simulate.models import (
    HarnessAssembledBundle,
    HarnessSuiteValidation,
    HostedHarnessJob,
)
from simulate.services.harness_versioning.assembly import bundle_key, certify_enabled
from simulate.services.harness_versioning.read import (
    _agent_label,
    _label,
    _message_label,
    version_refs,
)
from simulate.services.harness_versioning.versions import versioning_enabled
from simulate.services.hosted_harness import (
    ResolvedPins,
    VersionPicks,
    job_pins,
    resolve_run_pins,
)

_NO_VERSIONS = {"agent": None, "environment": None, "suite": None}


def _warning(code: str, message: str, piece: str | None) -> dict[str, Any]:
    return {"code": code, "message": message, "piece": piece}


def _prepares(pins: ResolvedPins) -> bool:
    """Whether a run of ``pins`` prepares its bundle rather than replaying it."""
    return (
        pins.runtime is not None
        and not pins.cached
        and (not pins.defaults or pins.unsealed)
        and certify_enabled()
    )


def _assembles(pins: ResolvedPins) -> bool:
    """Whether a run of ``pins`` replays or prepares a bundle at all."""
    return bool(pins.cached) or _prepares(pins)


def _cache_state(environment: HostedHarnessJob, pins: ResolvedPins) -> str | None:
    if pins.runtime is None:
        return None
    return (
        HarnessAssembledBundle._base_manager.filter(
            job_id=environment.id,
            assembly_key=bundle_key(
                pins.runtime, pins.environment_version, pins.suite_version
            ),
        )
        .values_list("state", flat=True)
        .first()
    )


def run_warnings(
    environment: HostedHarnessJob,
    pins: ResolvedPins | None,
    *,
    failed_before: bool = False,
) -> list[dict[str, Any]]:
    """Each ``{code, message, piece}`` a run of ``pins`` should show before it starts.

    ``failed_before`` reads the cache row as failed: a created run reset it.
    """
    if pins is None:
        return []
    environment_version, suite_version = pins.environment_version, pins.suite_version
    environment_label = _message_label(_label(environment_version.version_number))
    warnings = []
    if not HarnessSuiteValidation.no_workspace_objects.filter(
        suite_version=suite_version,
        environment_version=environment_version,
        status=HarnessSuiteValidation.Status.PASSED,
    ).exists():
        warnings.append(
            _warning(
                "suite_unproved",
                f"Suite {_message_label(_label(suite_version.version_number))}"
                " hasn't been proved"
                f" against environment {environment_label}",
                "suite",
            )
        )
    agent_version = pins.agent_version
    built_with = environment_version.agent_version_id
    if agent_version is not None and built_with and agent_version.id != built_with:
        label = _message_label(
            _agent_label(agent_version.version_name, agent_version.version_number)
        )
        warnings.append(
            _warning(
                "agent_differs",
                f"Agent {label} differs from the agent environment"
                f" {environment_label} was built with",
                "agent",
            )
        )
    # TODO: source_unavailable (piece agent) once a GitHub commit can be checked
    # cheaply; today only a sandbox clone resolves one.
    # TODO: variable_missing, provider_key_unavailable and credential_unavailable
    # with credentials (step 9); nudge_open with nudges (step 12).
    if not _prepares(pins):
        return warnings
    if failed_before or (
        _cache_state(environment, pins) == HarnessAssembledBundle.State.FAILED
    ):
        warnings.append(
            _warning(
                "bundle_cache_failed",
                "The last preparation of this combination failed and will be"
                " retried",
                None,
            )
        )
    else:
        warnings.append(
            _warning(
                "bundle_cache_miss",
                "The first run of this combination prepares it, which takes several"
                " minutes",
                None,
            )
        )
    return warnings


def _versions(pins: ResolvedPins | None) -> dict[str, Any]:
    if pins is None:
        return dict(_NO_VERSIONS)
    return version_refs(
        pins.agent_version, pins.environment_version, pins.suite_version
    )


def preview_run(
    environment: HostedHarnessJob, picks: VersionPicks | None = None
) -> dict[str, Any]:
    """The versions a run of ``picks`` would use, its warnings and whether its bundle
    is cached; ``bundle_cached`` is ``None`` when the run is not assembled."""
    pins = resolve_run_pins(environment, picks=picks)
    return {
        "versions": _versions(pins),
        "warnings": run_warnings(environment, pins),
        "bundle_cached": (
            pins.cached if pins is not None and _assembles(pins) else None
        ),
    }


def created_run(environment: HostedHarnessJob, job: HostedHarnessJob) -> dict[str, Any]:
    """The versions a created run is pinned to and its warnings, as its 202 shows them."""
    if not versioning_enabled():
        return {"versions": dict(_NO_VERSIONS), "warnings": []}
    pins = job_pins(environment, job)
    assembly = ((job.payload or {}).get("metadata") or {}).get("assembly") or {}
    return {
        "versions": _versions(pins),
        "warnings": run_warnings(
            environment, pins, failed_before=bool(assembly.get("failed_before"))
        ),
    }

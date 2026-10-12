from __future__ import annotations

import hashlib
import io
import json
import subprocess
import tarfile
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from simulate.serializers.harness_environment import (
    HarnessEnvironmentContractSerializer,
    HarnessEnvironmentDetailSerializer,
    HarnessEnvironmentWorldSerializer,
)
from simulate.serializers.harness_job import HarnessStageOutputSerializer
from simulate.services.harness_environment import (
    _contract_section,
    _environment_evidence,
    _world_section,
    environment_detail,
)
from simulate.services.harness_environment_evidence import EnvironmentEvidence
from simulate.services.hosted_harness_gateway import (
    _authoring_archive_command,
    authoring_stage_outputs,
    authoring_stage_outputs_from_archive,
)


def _fingerprinted(document):
    encoded = json.dumps(
        document, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()
    return {**document, "fingerprint": "sha256:" + hashlib.sha256(encoded).hexdigest()}


def _source_model():
    return _fingerprinted(
        {
            "schema_version": "futureagi.source-model.v2",
            "engine": "sqlite",
            "tables": [
                {
                    "name": "public.orders",
                    "columns": [
                        {"name": "id", "native_type": "", "nullable": False},
                        {
                            "name": "status",
                            "native_type": "TEXT",
                            "nullable": True,
                            "enum_values": ["open", "closed"],
                        },
                        {
                            "name": "customer_id",
                            "native_type": "INTEGER",
                            "nullable": False,
                        },
                    ],
                    "primary_key": ["id"],
                    "foreign_keys": [
                        {
                            "columns": ["customer_id"],
                            "referenced_table": "customers",
                            "referenced_columns": ["id"],
                        },
                        {
                            "columns": ["id", "status"],
                            "referenced_table": "history",
                            "referenced_columns": ["order_id", "status"],
                        },
                    ],
                }
            ],
        }
    )


def _certification():
    return _fingerprinted(
        {
            "schema_version": "futureagi.tool-certification.v1",
            "tools": [
                {
                    "tool": "lookup_order",
                    "availability": "runtime_only",
                    "probe_mode": "runtime_only",
                    "reason": "Observed during the call only",
                }
            ],
        }
    )


def _evidence(contract=None, **overrides):
    values = {
        "contract": contract or {"agent": "support", "modality": "chat"},
        "environment": None,
        "scenarios": None,
        "sub_goals": None,
        "stores": None,
        "source_model": None,
        "tool_certification": None,
    }
    return EnvironmentEvidence(**{**values, **overrides})


def _serialized_contract(evidence, connector="http", seed=42, mode=None):
    job = SimpleNamespace(
        payload={"agent": {"connector": connector, "mode": mode}, "seed": seed}
    )
    with patch(
        "simulate.services.harness_environment._provenance",
        return_value={
            "source": {},
            "built_by": None,
            "attempt": None,
            "snapshot": None,
            "digests": {},
            "authored_at": {},
        },
    ):
        section = _contract_section(job, evidence, evidence.schema_tables())
    return HarnessEnvironmentContractSerializer(section).data


@pytest.mark.parametrize("archived", [False, True])
def test_source_artifacts_reach_real_serializers_with_measured_rows(archived):
    prompt = "You handle order support.\nKeep the original whitespace.\n"
    origin = {
        "kind": "file",
        "path": "agent/prompt.txt",
        "line": None,
        "sha256": hashlib.sha256(prompt.encode()).hexdigest(),
    }
    contract = {
        "agent": "support",
        "modality": "voice",
        "call_direction": "inbound",
        "domain": {"id": "support", "label": "Order Support"},
        "one_liner": "Find an order",
        "system_prompt": prompt,
        "system_prompt_origin": origin,
        "hard_constraints": ["Verify identity"],
        "hard_constraint_details": [
            {
                "text": "Verify identity",
                "origin": origin,
                "enforced_by": ["prompt"],
                "sub_goal": "identity_checked",
            }
        ],
        "real_use_cases": ["Find an order"],
        "real_use_case_details": [
            {"text": "Find an order", "short": "Order lookup", "sub_goal": "invented"}
        ],
        "amendments": ["tool removed - charge_card: no runnable seam"],
        "amendment_details": [
            {
                "subject": "charge_card",
                "kind": "unreachable_tool",
                "reason": "no runnable seam",
            }
        ],
        "actors": [{"name": "support", "role": "assistant", "origin": origin}],
        "runtime_dependencies": [{"name": "orders", "used_by": ["lookup_order"]}],
        "data_store": {
            "configured_by": "DATABASE_URL",
            "location": "external_db",
            "configuration": {"source": "environment", "ref": "DATABASE_URL"},
        },
        "data_schema": {"orders": {"id": ""}},
        "data_schema_columns": {"orders": [{"name": "wrong", "type": "TEXT"}]},
        "tools": [
            {
                "name": "lookup_order",
                "effect": "Reads one order",
                "effect_kind": "read",
                "effect_evidence": {
                    "origin": origin,
                    "excerpt": "SELECT * FROM orders",
                },
            }
        ],
    }
    build = {
        "stores": [
            {
                "capability": "sql",
                "engine": "postgres",
                "strategy": "template_database",
                "row_counts": {
                    "orders": 0,
                    "_alk_tool_trace": 4,
                    "harness_seed_sentinel": 1,
                    "_business": 2,
                },
            }
        ]
    }
    kwargs = {
        "source_model": _source_model(),
        "tool_certification": _certification(),
        "build_output": build,
        "sub_goals": {
            "sub_goals": [{"name": "identity_checked", "what": "Identity is checked"}]
        },
    }
    if archived:
        documents = {
            "contract.json": contract,
            "build.json": build,
            "sub_goals.json": kwargs["sub_goals"],
            "generic-harness/source-model.json": kwargs["source_model"],
            "generic-harness/tool-certification.json": kwargs["tool_certification"],
        }
        outputs = authoring_stage_outputs_from_archive(_archive(documents))
    else:
        outputs = authoring_stage_outputs(contract, None, None, **kwargs)
    by_kind = {
        output["kind"]: output["data"]
        for output in HarnessStageOutputSerializer(outputs, many=True).data
    }
    evidence = _evidence(**by_kind)
    actual = _serialized_contract(evidence, connector="livekit", seed=0)
    assert actual["system_prompt"] == prompt
    assert actual["system_prompt_origin"] == origin
    assert actual["call_direction"] == "inbound"
    assert actual["domain"] == {"id": "support", "label": "Order Support"}
    assert actual["one_liner"] == "Find an order"
    assert actual["hard_constraints"] == ["Verify identity"]
    assert actual["hard_constraint_details"][0]["sub_goal"] == "identity_checked"
    assert "sub_goal" not in actual["real_use_case_details"][0]
    assert actual["real_use_cases"] == ["Find an order"]
    assert actual["amendments"] == [
        {"subject": "tool removed - charge_card", "note": "no runnable seam"}
    ]
    assert actual["amendment_details"] == contract["amendment_details"]
    assert actual["actors"] == contract["actors"]
    assert actual["runtime_dependencies"][0]["used_by"] == ["lookup_order"]
    assert actual["tools"][0]["effect_kind"] == "read"
    assert actual["data_store"]["configured_by"] == "DATABASE_URL"
    assert actual["data_schema"] == {"orders": {"id": ""}}
    columns = actual["data_schema_columns"]["public.orders"]
    assert columns == [
        {
            "name": "id",
            "type": "",
            "enum": [],
            "pk": True,
            "nullable": False,
            "references": None,
        },
        {
            "name": "status",
            "type": "TEXT",
            "enum": ["open", "closed"],
            "pk": False,
            "nullable": True,
            "references": None,
        },
        {
            "name": "customer_id",
            "type": "INTEGER",
            "enum": [],
            "pk": False,
            "nullable": False,
            "references": "customers.id",
        },
    ]
    assert actual["data_schema_tables"][0]["foreign_keys"][1]["columns"] == [
        "id",
        "status",
    ]
    assert actual["tool_certification"] == _certification()["tools"]
    assert actual["end_conditions"]["seed"] == {
        "value": 0,
        "controls": ["scenario_world_rng"],
    }
    assert "stop_on_constraint_violation" not in actual["end_conditions"]
    world = HarnessEnvironmentWorldSerializer(
        _world_section(None, [], evidence.store_tables(evidence.schema_tables()))
    ).data
    store = world["stores"][0]
    assert store["total_rows"] == 7
    tables = {table["name"]: table for table in store["tables"]}
    assert tables["orders"] == {
        "name": "orders",
        "rows": 0,
        "columns": columns,
        "internal": False,
    }
    assert tables["_alk_tool_trace"]["internal"] is True
    assert tables["harness_seed_sentinel"]["internal"] is True
    assert tables["_business"]["internal"] is False
    assert tables["_business"]["columns"] is None
    assert "customers" not in tables


@pytest.mark.parametrize("connector", ["vapi", "retell", "retell_chat"])
def test_provider_fields_keep_exact_schema_and_scrub_callback_url(connector):
    parameters = {
        "type": "object",
        "properties": {
            "api_key": {"type": "string"},
            "order": {"type": "string", "pattern": "^[A-Z]+$"},
        },
        "required": ["order"],
        "additionalProperties": False,
    }
    contract = {
        "agent": "provider",
        "modality": "voice",
        "call_direction": "inbound",
        "tool_entrypoints": [
            {
                "tool": "lookup_order",
                "mode": "provider",
                "implementation_origin": "provider_custom_function",
                "origin": {"kind": "tool_list", "field": "model.tools[0]"},
                "provider_function": {
                    "url": "https://user:password@example.test/tool?signature=secret#token",
                    "parameters": parameters,
                },
            },
            {
                "tool": "end_call",
                "mode": "provider",
                "implementation_origin": "provider_builtin",
            },
        ],
    }
    outputs = authoring_stage_outputs(contract, None, None)
    actual = _serialized_contract(_evidence(outputs[0]["data"]), connector=connector)
    assert "call_direction" not in actual
    tool = actual["tool_entrypoints"][0]
    assert tool["provider_function"] == {
        "url": "https://example.test/tool",
        "parameters": parameters,
    }
    assert tool["origin"]["field"] == "model.tools[0]"
    assert "source" not in tool
    assert "provider_function" not in actual["tool_entrypoints"][1]


def test_old_contract_keeps_legacy_values_and_absent_evidence():
    contract = {
        "agent": "old",
        "modality": "chat",
        "hard_constraints": ["Be kind"],
        "real_use_cases": ["Help"],
        "data_schema": {"orders": {"id": "INT"}},
        "data_store": {"configured_by": "DATABASE_URL"},
        "amendments": ["A note without a reason"],
    }
    actual = _serialized_contract(_evidence(contract), seed=None)
    assert actual["hard_constraints"] == ["Be kind"]
    assert actual["real_use_cases"] == ["Help"]
    assert actual["data_store"] == {"configured_by": "DATABASE_URL"}
    assert actual["data_schema"] == {"orders": {"id": "INT"}}
    assert actual["data_schema_columns"] is None
    assert actual["actors"] is None
    assert actual["amendment_details"] is None
    assert actual["amendments"] == [{"subject": "", "note": "A note without a reason"}]
    assert "tool_certification" not in actual
    assert "data_schema_tables" not in actual
    assert "seed" not in actual["end_conditions"]


def test_source_owned_provider_agent_keeps_direction():
    actual = _serialized_contract(
        _evidence({"agent": "source", "call_direction": "outbound"}),
        connector="vapi",
        mode="environment_backed",
    )
    assert actual["call_direction"] == "outbound"


@pytest.mark.parametrize(
    "prompt,digest",
    [
        ("Call https://user:secret@example.test/endpoint to find the order", None),
        ("Use API_KEY=secret-value to authenticate", None),
        ("Help the caller", "a" * 64),
    ],
)
def test_scrubbed_or_mismatched_prompts_never_claim_verbatim_provenance(prompt, digest):
    origin = {
        "kind": "file",
        "path": "prompt.txt",
        "sha256": digest or hashlib.sha256(prompt.encode()).hexdigest(),
    }
    output = authoring_stage_outputs(
        {
            "system_prompt": prompt,
            "system_prompt_origin": origin,
            "system_prompt_excerpt": "Help the caller",
        },
        None,
        None,
    )[0]["data"]
    assert "system_prompt" not in output
    assert "system_prompt_origin" not in output
    assert output["system_prompt_excerpt"] == "Help the caller"


def test_schema_secret_defaults_are_redacted_without_losing_property_types():
    parameters = {
        "type": "object",
        "$ref": "https://schemas.example.test/params?version=2",
        "properties": {"api_key": {"type": "string", "default": "real-secret"}},
    }
    output = authoring_stage_outputs(
        {
            "tool_entrypoints": [{"provider_function": {"parameters": parameters}}],
            "parameters": {"api_key": "another-secret"},
        },
        None,
        None,
    )[0]["data"]
    assert output["parameters"]["api_key"] == "[redacted]"
    assert output["tool_entrypoints"][0]["provider_function"]["parameters"] == {
        "type": "object",
        "$ref": "https://schemas.example.test/params?version=2",
        "properties": {"api_key": {"type": "string", "default": "[redacted]"}},
    }


def test_ambiguous_table_and_store_identities_do_not_acquire_columns():
    source = _source_model()
    second = deepcopy(source["tables"][0])
    second["name"] = "archive.orders"
    source["tables"].append(second)
    store = {
        "capability": "sql",
        "tables": [{"name": "orders", "rows": 9}, {"name": "public.orders", "rows": 3}],
    }
    evidence = _evidence(source_model=source, stores=[store])
    tables = evidence.store_tables(evidence.schema_tables())[0]["tables"]
    assert tables[0]["columns"] is None
    assert tables[1]["columns"][0]["name"] == "id"
    evidence = _evidence(
        source_model=source, stores=[store, {**store, "capability": "other"}]
    )
    assert all(
        table["columns"] is None
        for one in evidence.store_tables(evidence.schema_tables())
        for table in one["tables"]
    )


def _archive(documents):
    body = io.BytesIO()
    with tarfile.open(fileobj=body, mode="w:gz") as archive:
        for name, document in documents.items():
            data = json.dumps(document).encode()
            member = tarfile.TarInfo(name)
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    return body.getvalue()


def test_archive_ignores_wrong_paths_invalid_fingerprints_and_oversized_evidence():
    certificate = _certification()
    certificate["tools"][0]["availability"] = "certified"
    source = _source_model()
    source["padding"] = "x" * (8 * 1024 * 1024)
    outputs = authoring_stage_outputs_from_archive(
        _archive(
            {
                "contract.json": {"agent": "old"},
                "generic-harness/tool-certification.json": certificate,
                "source/tool-certification.json": _certification(),
                "generic-harness/source-model.json": source,
            }
        )
    )
    assert [output["kind"] for output in outputs] == ["contract"]


def test_detail_evidence_prefers_normalized_artifacts_in_one_query():
    job = SimpleNamespace(
        stage_outputs=[
            {"kind": "contract", "data": {"agent": "live"}},
            {"kind": "stores", "data": [{"capability": "live"}]},
        ]
    )
    with patch(
        "simulate.services.harness_environment.HostedHarnessStageOutput"
    ) as model:
        query = model.no_workspace_objects.filter.return_value
        query.values_list.return_value = [
            ("contract", {"agent": "verified"}),
            ("stores", [{"capability": "verified"}]),
        ]
        evidence = _environment_evidence(job)
    assert evidence.contract == {"agent": "verified"}
    assert evidence.stores == [{"capability": "verified"}]
    model.no_workspace_objects.filter.assert_called_once()


@pytest.mark.parametrize("built", [False, True])
def test_archive_command_includes_measured_build_when_present(tmp_path, built):
    authoring = tmp_path / "authoring"
    artifacts = tmp_path / "artifacts"
    authoring.mkdir()
    artifacts.mkdir()
    (authoring / "contract.json").write_text('{"agent":"source"}')
    if built:
        (artifacts / "build.json").write_text('{"stores":[]}')
    destination = tmp_path / "authoring.tar.gz"
    command = _authoring_archive_command(str(destination)).replace(
        "/work/", str(tmp_path) + "/"
    )
    subprocess.run(["sh", "-c", command], check=True)
    with tarfile.open(destination) as archive:
        names = archive.getnames()
    assert "./contract.json" in names
    assert ("build.json" in names) is built


@pytest.mark.django_db
def test_full_detail_serializes_stored_evidence_without_provider_or_storage_reads(
    user, workspace
):
    from simulate.models import HostedHarnessStageOutput
    from simulate.services.hosted_harness import create_hosted_job
    from simulate.tests.test_harness_provider import _v1_payload

    job, _ = create_hosted_job(
        user.organization,
        _v1_payload(),
        idempotency_key="th8038-source-evidence",
        workspace=workspace,
    )
    job.stage_outputs = authoring_stage_outputs(
        {"agent": "live", "modality": "chat"}, None, None
    )
    job.save(update_fields=["stage_outputs", "updated_at"])
    for output in authoring_stage_outputs(
        {"agent": "verified", "modality": "chat"},
        None,
        None,
        source_model=_source_model(),
        tool_certification=_certification(),
    ):
        HostedHarnessStageOutput.no_workspace_objects.create(
            job=job,
            kind=output["kind"],
            data=output["data"],
        )
    with (
        patch(
            "simulate.services.hosted_harness_gateway.get_storage_client",
            side_effect=AssertionError("storage read"),
        ),
        patch(
            "simulate.services.hosted_harness_gateway.get_sandbox_provider",
            side_effect=AssertionError("provider read"),
        ),
    ):
        actual = HarnessEnvironmentDetailSerializer(environment_detail(job)).data
    assert actual["contract"]["agent"] == "verified"
    assert actual["contract"]["data_schema_columns"]["public.orders"][0]["pk"] is True
    assert actual["contract"]["tool_certification"] == _certification()["tools"]

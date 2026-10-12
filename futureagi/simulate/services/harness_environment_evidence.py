"""Read-only joins of the source schema and measured environment stores."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

INTERNAL_TABLES = frozenset({"_alk_tool_trace", "harness_seed_sentinel"})


@dataclass(frozen=True)
class EnvironmentEvidence:
    contract: dict[str, Any]
    environment: dict[str, Any] | None
    scenarios: list[dict[str, Any]] | None
    sub_goals: dict[str, Any] | None
    stores: list[dict[str, Any]] | None
    source_model: dict[str, Any] | None
    tool_certification: dict[str, Any] | None

    def schema_tables(self) -> list[dict[str, Any]] | None:
        if self.source_model is None:
            return None
        tables = []
        for table in self.source_model.get("tables", []):
            primary_key = table.get("primary_key", [])
            foreign_keys = table.get("foreign_keys", [])
            columns = []
            for column in table.get("columns", []):
                references = [
                    f"{key['referenced_table']}.{key['referenced_columns'][0]}"
                    for key in foreign_keys
                    if key.get("columns") == [column["name"]]
                    and len(key.get("referenced_columns", [])) == 1
                ]
                columns.append(
                    {
                        "name": column["name"],
                        "type": column["native_type"],
                        "enum": column.get("enum_values", []),
                        "pk": column["name"] in primary_key,
                        "nullable": column["nullable"],
                        "references": references[0] if len(references) == 1 else None,
                    }
                )
            tables.append(
                {
                    "name": table["name"],
                    "columns": columns,
                    "primary_key": primary_key,
                    "foreign_keys": foreign_keys,
                }
            )
        return tables

    def store_tables(
        self, schema_tables: list[dict[str, Any]] | None
    ) -> list[dict[str, Any]]:
        stores = self.stores or []
        schema = (
            {table["name"]: table["columns"] for table in schema_tables}
            if schema_tables is not None
            else self.contract.get("data_schema_columns") or {}
        )
        # shortcut: SourceModel lacks store identity; join multiple stores when it records one.
        can_join = len(stores) == 1
        result = []
        for store in stores:
            tables = []
            for table in store.get("tables", []):
                name = table["name"]
                columns = schema.get(name) if can_join else None
                if can_join and columns is None and "." not in name:
                    matches = [
                        value
                        for identity, value in schema.items()
                        if identity.rsplit(".", 1)[-1] == name
                    ]
                    if len(matches) == 1:
                        columns = matches[0]
                tables.append(
                    {
                        **table,
                        "internal": name in INTERNAL_TABLES,
                        "columns": columns,
                    }
                )
            result.append({**store, "tables": tables})
        return result

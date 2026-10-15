from dataclasses import dataclass, field


@dataclass
class AnalyseRunInput:
    run_id: str


@dataclass
class AnalyseBatchInput:
    run_id: str
    unit_pks: list[int] = field(default_factory=list)


@dataclass
class AnalyseFailInput:
    run_id: str
    message: str

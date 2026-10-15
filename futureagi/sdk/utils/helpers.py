import structlog

logger = structlog.get_logger(__name__)
from model_hub.models.choices import ModelChoices
from tfc.constants.api_calls import APICallTypeChoices

model_to_api_call_type = {
    ModelChoices.TURING_LARGE: APICallTypeChoices.TURING_LARGE_EVALUATOR.value,
    ModelChoices.TURING_SMALL: APICallTypeChoices.TURING_SMALL_EVALUATOR.value,
    ModelChoices.TURING_FLASH: APICallTypeChoices.TURING_FLASH_EVALUATOR.value,
    ModelChoices.PROTECT_FLASH: APICallTypeChoices.PROTECT_FLASH_EVALUATOR.value,
    ModelChoices.PROTECT: APICallTypeChoices.PROTECT_EVALUATOR.value,
}


def _get_api_call_type(model: str):
    try:
        if not model:
            return APICallTypeChoices.TURING_LARGE_EVALUATOR.value

        model_key: ModelChoices | str = model
        if isinstance(model, str):
            try:
                model_key = ModelChoices(model)
            except ValueError:
                # Non-Turing/Protect models (e.g. "gpt-5", "gemini-...") are
                # legitimate user input but not part of ModelChoices. This is
                # expected, not an error: fall back to the default api call type.
                logger.warning("unknown_model_for_api_call_type", model=model)
                return APICallTypeChoices.TURING_LARGE_EVALUATOR.value

        return model_to_api_call_type.get(
            model_key, APICallTypeChoices.TURING_LARGE_EVALUATOR.value
        )
    except Exception as e:
        logger.exception(f"Error getting api call type: {e}")
        return APICallTypeChoices.TURING_LARGE_EVALUATOR.value


def _get_billing_event_type(api_call_type: str, *models, evaluator=None) -> str:
    """Event type for the billing UsageEvent of an eval run.

    Jev runs bill as jev_evaluator. api_call_type still drives the legacy
    APICallType/Pricing rows, which have no Jev entry, so callers keep it there.
    """
    from tfc.ee_gates import is_jev_model

    is_jev = any(is_jev_model(model) for model in models)
    if not is_jev and evaluator is not None:
        try:
            from ee.evals.llm.jev_evaluator.evaluator import JevEvaluator
        except ImportError:
            JevEvaluator = None
        is_jev = JevEvaluator is not None and isinstance(evaluator, JevEvaluator)
    if not is_jev:
        return api_call_type
    from ee.usage.schemas.event_types import BillingEventType

    return BillingEventType.JEV_EVALUATOR.value

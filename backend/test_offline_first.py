from ai_service import JurisGuardExtractionEngine


def test_offline_mode_does_not_invoke_cloud_path():
    engine = object.__new__(JurisGuardExtractionEngine)
    calls = []
    engine._run_offline_pipeline = lambda _: {
        "extraction_mode": "OFFLINE_SPACY_RULES",
        "offline_attempt": {"status": "completed", "fallback_eligible": False},
    }
    engine._run_online_pipeline = lambda _: calls.append("cloud")
    engine._sectioned_from_flat = lambda _: {}

    result = engine.execute_extraction("ignored.jpg", extraction_mode="offline")

    assert result["actual_extraction_mode"] == "offline"
    assert calls == []


def test_auto_runs_offline_before_authorized_cloud_fallback():
    engine = object.__new__(JurisGuardExtractionEngine)
    calls = []
    engine._run_offline_pipeline = lambda _: calls.append("offline") or {
        "extraction_mode": "OFFLINE_OCR_FAILED",
        "offline_attempt": {"status": "failed", "fallback_eligible": True, "reason": "paddleocr_error"},
    }
    engine._run_online_pipeline = lambda _: calls.append("cloud") or {"extraction_mode": "ONLINE_MISTRAL"}
    engine._sectioned_from_flat = lambda _: {}

    # Do not reach compression or the network: the cloud function above is a test double.
    import ai_service
    original_compress = ai_service.compress_image_for_vlm
    original_encode = ai_service.encode_image_to_base64
    ai_service.compress_image_for_vlm = lambda path: path
    ai_service.encode_image_to_base64 = lambda path: "test"
    try:
        engine.execute_extraction(
            "ignored.jpg", extraction_mode="auto", cloud_authorized=True,
            cloud_policy_enabled=True, cloud_approved=True,
        )
    finally:
        ai_service.compress_image_for_vlm = original_compress
        ai_service.encode_image_to_base64 = original_encode

    assert calls == ["offline", "cloud"]


def test_cloud_mode_without_policy_raises_permission_error():
    """Cloud mode explicitly requested but policy disabled → PermissionError."""
    engine = object.__new__(JurisGuardExtractionEngine)
    engine._run_offline_pipeline = lambda _: None
    engine._sectioned_from_flat = lambda _: {}

    import pytest
    with pytest.raises(PermissionError):
        engine.execute_extraction(
            "ignored.jpg", extraction_mode="cloud",
            cloud_authorized=True, cloud_policy_enabled=False, cloud_approved=True,
        )


def test_auto_successful_offline_does_not_call_cloud():
    """Auto mode with a successful offline extraction that is not fallback-eligible
    must not invoke the cloud pipeline, even when cloud is authorized."""
    engine = object.__new__(JurisGuardExtractionEngine)
    calls = []
    engine._run_offline_pipeline = lambda _: {
        "extraction_mode": "OFFLINE_SPACY_RULES",
        "offline_attempt": {"status": "completed", "fallback_eligible": False},
    }
    engine._run_online_pipeline = lambda _: calls.append("cloud")
    engine._sectioned_from_flat = lambda _: {}

    result = engine.execute_extraction(
        "ignored.jpg", extraction_mode="auto",
        cloud_authorized=True, cloud_policy_enabled=True, cloud_approved=True,
    )

    assert result["actual_extraction_mode"] == "offline"
    assert calls == [], "Cloud pipeline must not be called when offline succeeds without fallback eligibility"


def test_offline_mode_never_calls_cloud_even_when_authorized():
    """Offline mode must never invoke cloud, regardless of authorization flags."""
    engine = object.__new__(JurisGuardExtractionEngine)
    calls = []
    engine._run_offline_pipeline = lambda _: {
        "extraction_mode": "OFFLINE_OCR_FAILED",
        "offline_attempt": {"status": "failed", "fallback_eligible": True, "reason": "paddleocr_error"},
    }
    engine._run_online_pipeline = lambda _: calls.append("cloud")
    engine._sectioned_from_flat = lambda _: {}

    result = engine.execute_extraction(
        "ignored.jpg", extraction_mode="offline",
        cloud_authorized=True, cloud_policy_enabled=True, cloud_approved=True,
    )

    assert result["actual_extraction_mode"] == "offline"
    assert calls == [], "Cloud pipeline must never run in offline mode"

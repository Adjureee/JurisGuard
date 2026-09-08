from backend.benchmark_metrics import calculate_cer, calculate_wer


def test_cer_known_levenshtein_example():
    assert calculate_cer("kitten", "sitting") == 50.0


def test_wer_known_substitution_example():
    assert calculate_wer("one two", "one three") == 50.0


def test_empty_reference_metrics_are_explicit():
    assert calculate_cer("", "") == 0.0
    assert calculate_wer("", "text") == 100.0

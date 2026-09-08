"""Dependency-free OCR metric functions used by the benchmark evaluators."""


def levenshtein_distance(s1, s2) -> int:
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if not s2:
        return len(s1)
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            current_row.append(min(
                previous_row[j + 1] + 1,
                current_row[j] + 1,
                previous_row[j] + (c1 != c2),
            ))
        previous_row = current_row
    return previous_row[-1]


def calculate_cer(truth: str, ocr: str) -> float:
    """Character error rate, expressed as a percentage of reference characters."""
    if not truth:
        return 0.0 if not ocr else 100.0
    return (levenshtein_distance(truth, ocr) / len(truth)) * 100


def calculate_wer(truth: str, ocr: str) -> float:
    """Word error rate, expressed as a percentage of reference words."""
    truth_words, ocr_words = truth.split(), ocr.split()
    if not truth_words:
        return 0.0 if not ocr_words else 100.0
    return (levenshtein_distance(truth_words, ocr_words) / len(truth_words)) * 100

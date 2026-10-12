"""Small, explicitly defined NLP comparison adapters for the manuscript lab.

All candidates receive the same saved text. They map only the three target
entity fields below; the shared router supplies document-type classification.
These are rule/toolkit baselines, not trained JurisGuard models.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from .schema import empty_inventory


TARGET_FIELDS = ("Party Represented", "Address", "Court/Body")
_LABELS = {
    "Party Represented": re.compile(r"^\s*(?:Name|Pangalan|Party\s+Represented)\s*:\s*(.+)$", re.I),
    "Address": re.compile(r"^\s*(?:Address|Tirahan)\s*:\s*(.+)$", re.I),
    "Court/Body": re.compile(r"^\s*Court\s*/\s*Body\s*:\s*(.+)$", re.I),
}


def _assign_unique(inventory: dict, field: str, value: str) -> None:
    value = value.strip()
    if not value:
        return
    previous = inventory[field]
    if previous is None:
        inventory[field] = value
    elif previous != value:
        inventory[field] = None


class NLTKRules:
    """NLTK tokenization with transparent label rules; no corpus download."""

    def __init__(self) -> None:
        try:
            from nltk.tokenize import wordpunct_tokenize
        except ImportError as exc:
            raise RuntimeError("Install NLTK locally to run the NLTK baseline.") from exc
        self.tokenize = wordpunct_tokenize

    def extract(self, text: str) -> dict:
        inventory = empty_inventory()
        for line in text.splitlines():
            if ":" not in line:
                continue
            label, _ = line.split(":", 1)
            tokens = [token.casefold() for token in self.tokenize(label)]
            if not tokens:
                continue
            for field, pattern in _LABELS.items():
                match = pattern.match(line)
                if match and self.tokenize(match.group(0).split(":", 1)[0]):
                    _assign_unique(inventory, field, match.group(1))
        return inventory


class SpacyRegex:
    """spaCy Matcher finds label anchors; regex keeps their field values."""

    def __init__(self) -> None:
        try:
            import spacy
            from spacy.matcher import Matcher
        except ImportError as exc:
            raise RuntimeError("Install spaCy locally to run the spaCy + Regex candidate.") from exc
        self.nlp = spacy.blank("xx")
        self.matcher = Matcher(self.nlp.vocab)
        self.matcher.add("PERSON_LABEL", [[{"LOWER": {"IN": ["name", "pangalan"]}}, {"TEXT": ":"}]])
        self.matcher.add("ADDRESS_LABEL", [[{"LOWER": {"IN": ["address", "tirahan"]}}, {"TEXT": ":"}]])
        self.matcher.add("COURT_LABEL", [[{"LOWER": "court"}, {"TEXT": "/"}, {"LOWER": "body"}, {"TEXT": ":"}]])

    def extract(self, text: str) -> dict:
        inventory = empty_inventory()
        for line in text.splitlines():
            doc = self.nlp(line)
            anchors = {self.nlp.vocab.strings[match_id] for match_id, start, _ in self.matcher(doc) if start == 0}
            for field, label in (("Party Represented", "PERSON_LABEL"), ("Address", "ADDRESS_LABEL"), ("Court/Body", "COURT_LABEL")):
                if label in anchors:
                    match = _LABELS[field].match(line)
                    if match:
                        _assign_unique(inventory, field, match.group(1))
        return inventory


class BertNER:
    """Local token-classification checkpoint; only labeled entity spans map."""

    def __init__(self, model_dir: Path | None) -> None:
        if model_dir is None or not model_dir.is_dir() or not (model_dir / "config.json").is_file():
            raise RuntimeError("BERT needs an explicit local token-classification model directory; no download is allowed.")
        local_cache = Path(__file__).resolve().parents[1] / "data/outputs/hf-cache"
        local_cache.mkdir(parents=True, exist_ok=True)
        os.environ["HF_HOME"] = str(local_cache)
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        try:
            from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline
        except ImportError as exc:
            raise RuntimeError("Install Transformers and a compatible CPU PyTorch locally for the BERT candidate.") from exc
        try:
            tokenizer = AutoTokenizer.from_pretrained(str(model_dir), local_files_only=True)
            model = AutoModelForTokenClassification.from_pretrained(str(model_dir), local_files_only=True)
            self.ner = pipeline("token-classification", model=model, tokenizer=tokenizer, aggregation_strategy="simple", device=-1)
        except Exception as exc:
            raise RuntimeError(f"Local BERT checkpoint could not load: {type(exc).__name__}.") from exc

    def extract(self, text: str) -> dict:
        inventory = empty_inventory()
        labels = {"Party Represented": {"PER", "PERSON"}, "Address": {"LOC", "LOCATION"}, "Court/Body": {"ORG", "ORGANIZATION"}}
        for line in text.splitlines():
            for field, pattern in _LABELS.items():
                match = pattern.match(line)
                if not match:
                    continue
                value = match.group(1).strip()
                entities = self.ner(value)
                supported = [entity for entity in entities if str(entity.get("entity_group", "")).upper() in labels[field]]
                if len(supported) == 1:
                    _assign_unique(inventory, field, str(supported[0]["word"]).strip())
        return inventory


def make_nlp_candidate(name: str, *, bert_model: Path | None = None):
    if name == "nltk_rules":
        return NLTKRules()
    if name == "spacy_regex":
        return SpacyRegex()
    if name == "bert_ner":
        return BertNER(bert_model)
    raise ValueError(f"Unknown NLP candidate: {name}")

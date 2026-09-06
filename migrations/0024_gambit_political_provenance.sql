-- ============================================================
-- Open Gambit - political decision provenance
--
-- Additive only. 0021, 0022, and 0023 are already applied and remain
-- immutable. Existing candidates retain NULL provenance until a future
-- deterministic or triage decision is explicitly recorded.
-- ============================================================

ALTER TABLE gambit_candidates ADD COLUMN political_decision_source TEXT
  CHECK(political_decision_source IN ('DETERMINISTIC_POLICY','LLM_TRIAGE','HYBRID'));

ALTER TABLE gambit_candidates ADD COLUMN political_decision_confidence REAL;

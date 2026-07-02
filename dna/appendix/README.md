# Appendix

Non-normative aids that help an implementer: pseudocode, derivations, worked
examples, reference notes.

Rules:

- Content here is **one correct realization, not normative**. The normative truth
  is `../domain/`, `../product/`, and `../conformance/`.
- Exception: facts with no design freedom are data, not design, and are
  normative even as pseudocode/tables — e.g. `DAA` flag computation, the
  contention sequence `6,5,4,3,2,1,0,0`, opcode tables, ROM entry addresses.
  Keep those in `../domain/`; cross-reference from here if helpful.
- Pseudocode here MUST NOT be copied structurally by the implementer; it is an
  aid to understanding, not an architecture to reproduce.

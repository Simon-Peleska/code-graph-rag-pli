# Kartenbank: raw vs harness

Model gemma4:26b (docs and app), judge gemma4:31b, 2026-11-10T08:01.

| | raw | harness |
|---|---|---|
| material (characters) | 92349 | 55763 |
| docs (characters) | 8991 | 9292 |
| app: case steps passed | 0/24 (INTEREST 0/8, POST 0/8, STATEMENT 0/8) | 0/24 (INTEREST 0/8, POST 0/8, STATEMENT 0/8) |
| app: output lines right | 0.0 % | 0.0 % |
| app needed the repair round | yes | yes |
| gold rules correct | 20/38 | 12/38 |
| gold rules partial | 11/38 | 18/38 |
| gold rules wrong | 1/38 | 4/38 |
| gold rules missing | 6/38 | 4/38 |
| understandability (1-5) | 3 | 3 |
| minutes (material, docs, app, judge) | 0, 8, 3, 7 | 27, 5, 8, 8 |

## Rule by rule

| rule | raw | harness |
|---|---|---|
| P-01 | correct | correct |
| P-02 | correct | correct |
| P-03 | partial | wrong |
| P-04 | correct | correct |
| P-05 | correct | correct |
| P-06 | correct | correct |
| P-07 | correct | correct |
| P-08 | correct | correct |
| P-09 | correct | partial |
| P-10 | correct | partial |
| P-11 | correct | partial |
| P-12 | correct | partial |
| P-13 | partial | partial |
| P-14 | missing | missing |
| P-15 | partial | partial |
| P-16 | partial | correct |
| P-17 | partial | partial |
| P-18 | missing | missing |
| I-01 | correct | correct |
| I-02 | partial | partial |
| I-03 | missing | partial |
| I-04 | wrong | correct |
| I-05 | correct | partial |
| I-06 | partial | partial |
| I-07 | correct | partial |
| I-08 | partial | partial |
| I-09 | correct | partial |
| I-10 | partial | missing |
| I-11 | correct | partial |
| S-01 | correct | partial |
| S-02 | partial | partial |
| S-03 | correct | partial |
| D-01 | missing | wrong |
| D-02 | missing | wrong |
| D-03 | correct | correct |
| D-04 | partial | wrong |
| D-05 | correct | correct |
| D-06 | missing | missing |

## The judge on understandability

- raw: The documentation is well-structured and provides excellent data layouts, making it easy to understand the data flow. However, it lacks critical business logic details (constants, specific ID formats, and fallback rules) necessary for a perfect implementation.
- harness: The documentation is well-structured and provides a good high-level overview of the data flow and job sequence. However, it is unreliable for a developer because it contains contradictions regarding decommissioned logic and lacks the specific constants needed for an exact implementation.

## First failures of each app

### raw

- `CHK001E case01/INTEREST crashed: File "/home/simon/projects/code-graph-rag-pli/eval/results/raw/app.py", line 56     def f_int(val, width): return pad(str(int(round(val * 100)))[len(str(int(round(val * 100))) - width + 1:] if len(str(int(round(val * 100))) > width else 0).zfill(width), width)       `
- `CHK001E case02/INTEREST crashed: File "/home/simon/projects/code-graph-rag-pli/eval/results/raw/app.py", line 56     def f_int(val, width): return pad(str(int(round(val * 100)))[len(str(int(round(val * 100))) - width + 1:] if len(str(int(round(val * 100))) > width else 0).zfill(width), width)       `
- `CHK001E case01/POST crashed: File "/home/simon/projects/code-graph-rag-pli/eval/results/raw/app.py", line 56     def f_int(val, width): return pad(str(int(round(val * 100)))[len(str(int(round(val * 100))) - width + 1:] if len(str(int(round(val * 100))) > width else 0).zfill(width), width)           `
- `CHK001E case02/POST crashed: File "/home/simon/projects/code-graph-rag-pli/eval/results/raw/app.py", line 56     def f_int(val, width): return pad(str(int(round(val * 100)))[len(str(int(round(val * 100))) - width + 1:] if len(str(int(round(val * 100))) > width else 0).zfill(width), width)           `
- `CHK001E case01/STATEMENT crashed: File "/home/simon/projects/code-graph-rag-pli/eval/results/raw/app.py", line 56     def f_int(val, width): return pad(str(int(round(val * 100)))[len(str(int(round(val * 100))) - width + 1:] if len(str(int(round(val * 100))) > width else 0).zfill(width), width)      `
- `CHK001E case02/STATEMENT crashed: File "/home/simon/projects/code-graph-rag-pli/eval/results/raw/app.py", line 56     def f_int(val, width): return pad(str(int(round(val * 100)))[len(str(int(round(val * 100))) - width + 1:] if len(str(int(round(val * 100))) > width else 0).zfill(width), width)      `

### harness

- `CHK002E case01/INTEREST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201000+0000002500+0000011491999999990100000113" got undefined`
- `CHK002E case01/INTEREST/TRANOUT line 1: want "MG40000001039000050002ZINSLAUF  MAHNGEBUEHR                   +00000035000000000000000                202603194000000103920260319" got undefined`
- `CHK002E case01/POST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201005+0000002500+0000011491999999990100000113" got undefined`
- `CHK002E case01/POST/REJECTS line 1: want "T001000000000000108HAENDLERKATEGORIE GESPERRT" got undefined`
- `CHK002E case01/STATEMENT/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000000000+0000000000AKTION201000+0000009932+0000000000999999990100000113" got undefined`
- `CHK002E case01/STATEMENT/STMTFILE line 1: want "40000001000EVA WEBER                                     +0000496606+000000993220260413999999990A+0000068280+0000005364" got undefined`

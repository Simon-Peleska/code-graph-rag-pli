# Kartenbank: raw vs harness

Model qwen3.8:27b (docs and app), judge gemma4:31b, 2026-11-10T16:35.

| | raw | harness |
|---|---|---|
| material (characters) | 92439 | 91033 |
| docs (characters) | 23342 | 18356 |
| app: case steps passed | 0/24 (INTEREST 0/8, POST 0/8, STATEMENT 0/8) | 0/24 (INTEREST 0/8, POST 0/8, STATEMENT 0/8) |
| app: output lines right | 30.4 % | 21.9 % |
| app needed the repair round | no | no |
| gold rules correct | 38/38 | 33/38 |
| gold rules partial | 0/38 | 1/38 |
| gold rules wrong | 0/38 | 2/38 |
| gold rules missing | 0/38 | 2/38 |
| understandability (1-5) | 5 | 5 |
| minutes (material, docs, app, judge) | 0, 42, 22, 9 | 5, 36, 15, 8 |

## Rule by rule

| rule | raw | harness |
|---|---|---|
| P-01 | correct | correct |
| P-02 | correct | correct |
| P-03 | correct | correct |
| P-04 | correct | correct |
| P-05 | correct | correct |
| P-06 | correct | correct |
| P-07 | correct | correct |
| P-08 | correct | correct |
| P-09 | correct | correct |
| P-10 | correct | correct |
| P-11 | correct | correct |
| P-12 | correct | correct |
| P-13 | correct | correct |
| P-14 | correct | missing |
| P-15 | correct | correct |
| P-16 | correct | correct |
| P-17 | correct | correct |
| P-18 | correct | correct |
| I-01 | correct | correct |
| I-02 | correct | correct |
| I-03 | correct | correct |
| I-04 | correct | correct |
| I-05 | correct | correct |
| I-06 | correct | correct |
| I-07 | correct | correct |
| I-08 | correct | correct |
| I-09 | correct | correct |
| I-10 | correct | correct |
| I-11 | correct | correct |
| S-01 | correct | correct |
| S-02 | correct | partial |
| S-03 | correct | correct |
| D-01 | correct | correct |
| D-02 | correct | wrong |
| D-03 | correct | correct |
| D-04 | correct | wrong |
| D-05 | correct | correct |
| D-06 | correct | missing |

## The judge on understandability

- raw: The documentation is exceptionally clear, providing both high-level job flow and granular logic. It includes detailed data layouts and a comprehensive constants table, making it an ideal blueprint for a developer.
- harness: The documentation is exceptionally well-structured, providing clear record layouts and step-by-step processing logic. A developer could implement the system almost entirely from this document without needing the source code.

## First failures of each app

### raw

- `CHK002E case01/INTEREST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201000+0000002500+0000011491999999990100000113" got "40000001000A000004966060000500000000010000020170318202602070000000536400000068280AKTION201000000000025000000001149`
- `CHK002E case01/INTEREST/TRANOUT line 1: want "MG40000001039000050002ZINSLAUF  MAHNGEBUEHR                   +00000035000000000000000                202603194000000103920260319" got "MG40000001039000050002ZINSLAUF  MAHNGEBUEHR                   000000035000000000000000                2026031940000001`
- `CHK002E case01/POST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201005+0000002500+0000011491999999990100000113" got "40000001000A000004966060000500000000010000020170318202602070000000536400000068280AKTION2010050000000250000000011491999`
- `CHK002E case01/POST/TCATOUT line 1: want "40000001000020001+0000000000" got "4000000100002000100000000000"`
- `CHK002E case01/STATEMENT/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000000000+0000000000AKTION201000+0000009932+0000000000999999990100000113" got "40000001000A000004966060000500000000010000020170318202602070000000000000000000000AKTION20100000000009932000000000`
- `CHK002E case01/STATEMENT/STMTFILE line 1: want "40000001000EVA WEBER                                     +0000496606+000000993220260413999999990A+0000068280+0000005364" got "40000001000EVA                  WEBER                    000004966060000000993220260413999999990A0000006828000000005364"`

### harness

- `CHK002E case01/INTEREST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201000+0000002500+0000011491999999990100000113" got "40000001000A 0000496606000050000000001000002017031820260207 0000005364 0000068280AKTION201000 0000002500 000001149`
- `CHK002E case01/INTEREST/TRANOUT line 1: want "MG40000001039000050002ZINSLAUF  MAHNGEBUEHR                   +00000035000000000000000                202603194000000103920260319" got "MG40000001039000050002ZINSLAUF  MAHNGEBUEHR                    00000035000000000000000                2026031940000001`
- `CHK002E case01/POST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201005+0000002500+0000011491999999990100000113" got "40000001000A 0000496606000050000000001000002017031820260207 0000005364 0000068280AKTION201005 0000002500 0000011491999`
- `CHK002E case01/POST/TCATOUT line 1: want "40000001000020001+0000000000" got "40000001000020001 0000000000"`
- `CHK002E case01/STATEMENT/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000000000+0000000000AKTION201000+0000009932+0000000000999999990100000113" got "40000001000A 0000496606000050000000001000002017031820260207 0000000000 0000000000AKTION201000 0000009932 00000000`
- `CHK002E case01/STATEMENT/STMTFILE line 1: want "40000001000EVA WEBER                                     +0000496606+000000993220260413999999990A+0000068280+0000005364" got "40000001000EVA WEBER                                      0000496606 000000993220260413999999990A 0000068280 0000005364"`

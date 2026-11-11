# Kartenbank: raw vs harness

Model qwen3.8:27b (docs and app), judge gemma4:31b, 2026-11-10T12:08.

| | raw | harness |
|---|---|---|
| material (characters) | 92439 | 79139 |
| docs (characters) | 23342 | 23122 |
| app: case steps passed | 0/24 (INTEREST 0/8, POST 0/8, STATEMENT 0/8) | 0/24 (INTEREST 0/8, POST 0/8, STATEMENT 0/8) |
| app: output lines right | 30.4 % | 9.1 % |
| app needed the repair round | no | no |
| gold rules correct | 38/38 | 30/38 |
| gold rules partial | 0/38 | 6/38 |
| gold rules wrong | 0/38 | 2/38 |
| gold rules missing | 0/38 | 0/38 |
| understandability (1-5) | 5 | 5 |
| minutes (material, docs, app, judge) | 0, 42, 22, 9 | 67, 35, 18, 9 |

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
| P-14 | correct | partial |
| P-15 | correct | correct |
| P-16 | correct | correct |
| P-17 | correct | correct |
| P-18 | correct | correct |
| I-01 | correct | correct |
| I-02 | correct | correct |
| I-03 | correct | correct |
| I-04 | correct | correct |
| I-05 | correct | correct |
| I-06 | correct | partial |
| I-07 | correct | correct |
| I-08 | correct | partial |
| I-09 | correct | partial |
| I-10 | correct | correct |
| I-11 | correct | correct |
| S-01 | correct | partial |
| S-02 | correct | correct |
| S-03 | correct | correct |
| D-01 | correct | correct |
| D-02 | correct | wrong |
| D-03 | correct | correct |
| D-04 | correct | wrong |
| D-05 | correct | correct |
| D-06 | correct | partial |

## The judge on understandability

- raw: The documentation is exceptionally clear, providing both high-level job flow and granular logic. It includes detailed data layouts and a comprehensive constants table, making it an ideal blueprint for a developer.
- harness: The documentation is exceptionally detailed, providing exact record layouts, field positions, and a clear step-by-step logical flow. A developer could implement the system almost entirely from this document without needing to see the original PL/I code.

## First failures of each app

### raw

- `CHK002E case01/INTEREST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201000+0000002500+0000011491999999990100000113" got "40000001000A000004966060000500000000010000020170318202602070000000536400000068280AKTION201000000000025000000001149`
- `CHK002E case01/INTEREST/TRANOUT line 1: want "MG40000001039000050002ZINSLAUF  MAHNGEBUEHR                   +00000035000000000000000                202603194000000103920260319" got "MG40000001039000050002ZINSLAUF  MAHNGEBUEHR                   000000035000000000000000                2026031940000001`
- `CHK002E case01/POST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201005+0000002500+0000011491999999990100000113" got "40000001000A000004966060000500000000010000020170318202602070000000536400000068280AKTION2010050000000250000000011491999`
- `CHK002E case01/POST/TCATOUT line 1: want "40000001000020001+0000000000" got "4000000100002000100000000000"`
- `CHK002E case01/STATEMENT/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000000000+0000000000AKTION201000+0000009932+0000000000999999990100000113" got "40000001000A000004966060000500000000010000020170318202602070000000000000000000000AKTION20100000000009932000000000`
- `CHK002E case01/STATEMENT/STMTFILE line 1: want "40000001000EVA WEBER                                     +0000496606+000000993220260413999999990A+0000068280+0000005364" got "40000001000EVA                  WEBER                    000004966060000000993220260413999999990A0000006828000000005364"`

### harness

- `CHK002E case01/INTEREST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201000+0000002500+0000011491999999990100000113" got "40000001000A000049660600005000000000100000201703182026020700000053640000068280AKTION201000000000250000000114919999`
- `CHK002E case01/INTEREST/TRANOUT line 1: want "MG40000001039000050002ZINSLAUF  MAHNGEBUEHR                   +00000035000000000000000                202603194000000103920260319" got "MA40000001039000050001          MAHNGEBUEHR                   0000003500                             20260319 40000001`
- `CHK002E case01/POST/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000005364+0000068280AKTION201005+0000002500+0000011491999999990100000113" got "40000001000A000049660600005000000000100000201703182026020700000053640000068280AKTION2010050000002500000001149199999999`
- `CHK002E case01/POST/REJECTS line 1: want "T001000000000000108HAENDLERKATEGORIE GESPERRT" got "T001000000000000108MCC GESPERRT"`
- `CHK002E case01/STATEMENT/ACCTOUT line 1: want "40000001000A+0000496606000050000000001000002017031820260207+0000000000+0000000000AKTION201000+0000009932+0000000000999999990100000113" got "40000001000A000049660600005000000000100000201703182026020700000000000000000000AKTION20100000000010000000000000999`
- `CHK002E case01/STATEMENT/STMTFILE line 1: want "40000001000EVA WEBER                                     +0000496606+000000993220260413999999990A+0000068280+0000005364" got "40000001000EVA                  WEBER                    0000496606000002483020260413999999990A00000682800000005364"`

# Kartenbank online

Two IMS transactions on the Db2 table `KB.KONTO`, an online copy of the
account master:

- `KB01` Kontoauskunft: `KBP00006`, screen `KBF00001`.
- `KB02` Limitänderung: `KBP00007`, screen `KBF00002`, logs each change in
  `KB.LIMIT_HIST`.

They are defined in `repo/IMS/KBSYSDEF` and the tables in `repo/DDL/KBT00001`.

## Run it

1. Run *PL/I Graph: Generate JavaScript* on `repo` into a folder, say `out`.
2. Load the accounts of a case into a SQLite file:
   `node online/seed.mjs out kb.db` (case01's `ACCTFILE` by default, another
   one as a third argument).
3. Start the app: `cd out && SQLITE=../kb.db node server.js`, then open
   <http://localhost:8080/KB01> or `/KB02`. The screens run on the 3270
   terminal: type into the fields (a full field skips to the next one), Tab
   moves on, Enter sends.

Amounts are typed with a decimal comma (`12000,00`). Without the comma the last
two digits are the cents, as the `PIC '(8)9V99'` field reads them.

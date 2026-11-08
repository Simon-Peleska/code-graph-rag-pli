(comment) @comment
(sequence_number) @comment

[
  "JOB" "EXEC" "DD" "PROC" "PEND" "SET" "JCLLIB" "INCLUDE" "OUTPUT"
  "IF" "THEN" "ELSE" "ENDIF" "CNTL" "ENDCNTL" "EXPORT" "SCHEDULE" "XMIT" "COMMAND"
] @keyword

(operation) @keyword

(name) @label

(parameter key: (keyword) @property)

(string) @string

(condition (operator) @operator)
"=" @operator

["(" ")"] @punctuation.bracket

[(delimiter) (jes2_statement)] @keyword.directive

(data_line) @string.special

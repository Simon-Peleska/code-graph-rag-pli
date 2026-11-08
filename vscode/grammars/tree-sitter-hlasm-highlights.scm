(comment) @comment
(remarks) @comment
(sequence_number) @comment
(continuation) @punctuation.special

(string) @string

(name) @label
(operation) @function

(keyword) @property

((word) @number
  (#match? @number "^[0-9]+$"))

((word) @variable
  (#match? @variable "^&"))

(operator) @operator

["(" ")"] @punctuation.bracket
["," "="] @punctuation.delimiter

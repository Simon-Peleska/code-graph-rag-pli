; Comments and literals

(comment) @comment

(string_literal) @string
(bit_literal) @string.special
(hex_literal) @string.special
(number) @number

; Preprocessor

"%" @keyword.directive

; Labels

(statement_prefix label: (identifier) @label)

; Declared names

(declaration_item name: (identifier) @variable)

(builtin_name) @function.builtin

; Embedded SQL / other embedded languages

"exec" @keyword
(exec_statement language: (identifier) @keyword.directive)
(host_variable) @variable.special

(exec_statement member: (identifier) @module)
(exec_statement table: (identifier) @type)
(exec_statement cursor: (identifier) @variable.special)

[
  "insert"
  "cursor"
  "where"
  "values"
  "commit"
  "rollback"
  "work"
  "as"
  "and"
  "or"
  "not"
  "null"
  "is"
  "between"
  "exists"
  "distinct"
  "all"
  "order"
  "group"
  "having"
  "case"
  "for"
  "of"
] @keyword

(reference
  .
  (identifier) @function
  "(" )

; Keywords

[
  "procedure"
  "proc"
  "package"
  "begin"
  "end"
  "entry"
  "return"
  "goto"
  "go"
  "to"
  "stop"
  "exit"
  "iterate"
  "leave"
  "call"
  "fetch"
  "on"
  "revert"
  "signal"
  "declare"
  "dcl"
  "allocate"
  "free"
  "format"
  "default"
  "options"
  "returns"
  "like"
  "defined"
  "def"
  "based"
  "initial"
  "init"
  "refer"
  "position"
  "environment"
  "env"
  "set"
  "in"
  "range"
] @keyword

[
  "if"
  "then"
  "else"
  "do"
  "while"
  "until"
  "by"
  "repeat"
  "select"
  "when"
  "otherwise"
] @keyword.control.conditional

[
  "fixed"
  "float"
  "decimal"
  "dec"
  "binary"
  "bin"
  "character"
  "char"
  "bit"
  "picture"
  "pic"
  "pointer"
  "ptr"
  "offset"
  "area"
  "file"
  "label"
  "task"
  "event"
  "varying"
  "var"
  "varyingz"
  "nonvarying"
  "static"
  "automatic"
  "auto"
  "controlled"
  "ctl"
  "internal"
  "int"
  "external"
  "ext"
  "parameter"
  "parm"
  "aligned"
  "unaligned"
  "unal"
  "signed"
  "unsigned"
  "union"
  "complex"
  "cplx"
  "real"
  "variable"
] @type

[
  "open"
  "close"
  "read"
  "write"
  "rewrite"
  "delete"
  "get"
  "put"
  "list"
  "edit"
  "data"
  "into"
  "from"
  "key"
  "keyto"
  "keyfrom"
  "ignore"
  "string"
  "page"
  "skip"
  "line"
  "linesize"
  "pagesize"
  "title"
  "input"
  "output"
  "update"
  "stream"
  "record"
  "sequential"
  "direct"
  "buffered"
  "unbuffered"
  "print"
  "backwards"
  "keyed"
] @function.builtin

[
  "error"
  "endfile"
  "endpage"
  "transmit"
  "undefinedfile"
  "undefinedfilekey"
  "name"
  "conversion"
  "fixedoverflow"
  "overflow"
  "underflow"
  "zerodivide"
  "size"
  "stringrange"
  "stringsize"
  "subscriptrange"
  "attention"
  "condition"
  "anycondition"
] @constant.builtin

; Operators

[
  "+" "-" "*" "/" "**" "||" "!!"
  "<" "<=" "=" ">" ">=" "¬=" "^=" "¬<" "^<" "¬>" "^>"
  "&" "|" "!" "¬" "^" "->"
] @operator

[ "(" ")" ] @punctuation.bracket
[ "," ";" ":" "." ] @punctuation.delimiter

(comment) @comment

[ "ALIAS" "ALL" "AND" "ANY" "AS" "ASC" "ASENSITIVE" "AT" "ATOMIC" "BEGIN" 
"BETWEEN" "BY" "CALL" "CASE" "CHANGE" "CHECK" "CLOSE" "CONCAT" "CONSTRAINT" 
"CREATE" "CROSS" "CURRENT" "CURSOR" "DATA" "DAY" "DAYS" "DECLARE" "DELETE" 
"DESC" "DESCRIPTOR" "DISTINCT" "DYNAMIC" "ELSE" "END" "END CASE" "END-EXEC" 
"ESCAPE" "EXCEPT" "EXEC" "EXISTS" "FETCH" "FINAL" "FIRST" "FOR" "FOREIGN" 
"FROM" "FULL" "GLOBAL" "GROUP" "GROUPING" "HAVING" "HOUR" "HOURS" "IGNORE" 
"IN" "INCLUDE" "INDEX" "INDICATOR" "INNER" "INSENSITIVE" "INSERT" "INTERSECT" 
"INTO" "IS" "JOIN" "LATERAL" "LEFT" "LIKE" "LIMIT" "LOCAL" "LOCKED" "MATCHED" 
"MERGE" "MICROSECOND" "MICROSECONDS" "MINUTE" "MINUTES" "MONTH" "MONTHS" 
"NEW" "NEXT" "NEXTVAL" "NO" "NOT" "NOT ATOMIC" "OF" "OFFSET" "OLD" "ON" 
"ONLY" "OPEN" "OPTIMIZE" "OR" "ORDER" "ORDINALITY" "OUTER" "OVER" 
"OVERRIDING" "PERIOD" "PORTION" "PREVIOUS" "PREVVAL" "PRIMARY" "PUBLIC" 
"QUERYNO" "REFERENCES" "REPLACE" "RIGHT" "ROW" "ROWS" "ROWSET" "SCROLL" 
"SECOND" "SECONDS" "SELECT" "SENSITIVE" "SEQUENCE" "SET" "SETS" "SIGNAL" 
"SKIP" "SOME" "SQL" "STATIC" "SYNONYM" "TABLE" "TEMPORARY" "THEN" "TIME" "TO" 
"UNION" "UNIQUE" "UPDATE" "USING" "VALUE" "VALUES" "VIEW" "WHEN" "WHERE" 
"WITH" "WITHIN" "WITHOUT" "YEAR" "YEARS" "ZONE" "WITH TIME ZONE" "ARRAY[" ] @keyword

(null) @constant.builtin
(string) @string
(datetime_literal) @string
(number) @number
(host_variable) @variable
(indicator) @variable
(parameter_marker) @variable

(statement operation: (identifier) @keyword)
(special_register (identifier) @variable.builtin)
(special_register [ "SESSION TIME ZONE" "CLIENT" ] @variable.builtin)

(function_call name: (object_name (identifier) @function .))
(call_statement procedure: (object_name (identifier) @function .))

(table_reference table: (object_name) @type)
(insert_statement table: (object_name) @type)
(update_statement table: (object_name) @type)
(delete_statement table: (object_name) @type)
(merge_statement table: (object_name) @type)
(references_clause table: (object_name) @type)
(create_table_statement name: (object_name) @type)
(declare_table_statement name: (object_name) @type)
(create_view_statement name: (object_name) @type)

(column_definition name: (_) @property)
(data_type) @type.builtin
(correlation name: (_) @label)

[ "=" "<>" "¬=" "!=" "^=" "<" ">" "<=" ">=" "+" "-" "*" "/" "||" ] @operator
(operator) @operator
[ "(" ")" "[" "]" "??(" "??)" ] @punctuation.bracket
[ "," "." ";" ] @punctuation.delimiter

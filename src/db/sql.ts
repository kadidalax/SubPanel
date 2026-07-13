// ponytail: migrations contain no semicolons inside SQL literals; use a parser if that changes.
export function splitSqlStatements(sql: string): string[] {
  return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

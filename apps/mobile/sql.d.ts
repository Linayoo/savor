// Drizzle migrations are .sql files inlined as strings by babel-plugin-inline-import
declare module "*.sql" {
  const sql: string;
  export default sql;
}

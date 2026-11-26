// PostgreSQL-Verbindung aus der Umgebung: DB_URL oder Einzelvariablen DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME.
function baueVerbindung(env) {
  if (env.DB_URL) return { connectionString: env.DB_URL };
  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER || 'lerntherapie',
    password: env.DB_PASSWORD || 'lerntherapie',
    database: env.DB_NAME || 'lerntherapie',
  };
}

module.exports = { baueVerbindung };

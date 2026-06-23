import pg from "pg";

let pool = null;

export async function initDb() {
  if (!process.env.DATABASE_URL) return;
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`
    create table if not exists downloads (
      id text primary key,
      payload jsonb not null,
      state text not null,
      progress numeric default 0,
      file_name text,
      output_path text,
      error text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )
  `);
}

export async function persistJob(job) {
  if (!pool) return;
  await pool.query(
    `insert into downloads (id, payload, state, progress, file_name, output_path, error, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (id) do update set
       payload = excluded.payload,
       state = excluded.state,
       progress = excluded.progress,
       file_name = excluded.file_name,
       output_path = excluded.output_path,
       error = excluded.error,
       updated_at = now()`,
    [job.id, job.request, job.state, job.progress, job.fileName, job.outputPath, job.error]
  );
}


// ─────────────────────────────────────────────────────────────
// Supabase (PostgreSQL) implementation of the db interface.
// Same method signatures as dbMemory. Soft-delete + unique keys
// are enforced by the database (see schema.sql), so this layer
// stays thin and just maps errors to friendly codes.
// ─────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';
import { newId } from '../lib/ids.js';
import { nowISO } from '../lib/dates.js';

const url = import.meta.env?.VITE_SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail loudly at startup rather than silently losing data.
  // Set the two env vars in .env (see .env.example) to use supabase mode.
  console.error('[OrthoStock] Supabase mode selected but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing.');
}

const supabase = createClient(url || 'http://localhost', key || 'anon');

function mapError(error) {
  if (!error) return null;
  // Postgres unique violation.
  if (error.code === '23505') {
    const e = new Error(error.message || 'Duplicate value');
    e.code = 'DUPLICATE';
    return e;
  }
  const e = new Error(error.message || 'Database error');
  e.code = 'DB_ERROR';
  return e;
}

const api = {
  async getAll(table) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) throw mapError(error);
    return data || [];
  },

  async findBy(table, field, value) {
    const { data, error } = await supabase.from(table).select('*').eq(field, value).limit(1);
    if (error) throw mapError(error);
    return (data && data[0]) || null;
  },

  async insert(table, row) {
    const record = { id: row.id || newId(), ...row };
    if (['purchases', 'invoices', 'stockMovements'].includes(table)) {
      record.createdAt = record.createdAt || nowISO();
    }
    const { data, error } = await supabase.from(table).insert(record).select().single();
    if (error) throw mapError(error);
    return data;
  },

  async update(table, id, patch) {
    const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
    if (error) throw mapError(error);
    return data;
  },

  async remove(table, id) {
    // Soft-delete tables: flip isActive. Others: real delete.
    const soft = ['categories', 'products', 'variants', 'customers', 'suppliers', 'users'];
    if (soft.includes(table)) {
      const { error } = await supabase.from(table).update({ isActive: false }).eq('id', id);
      if (error) throw mapError(error);
    } else {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw mapError(error);
    }
    return true;
  },
};

export default api;

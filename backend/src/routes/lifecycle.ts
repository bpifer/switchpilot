import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { audit } from '../audit.js';
import { requireRole } from '../auth/rbac.js';
import { invalidateLifecycleCache } from '../cisco/lifecycle.js';

export default async function lifecycleRoutes(app: FastifyInstance) {
  // List the full lifecycle catalog (longest prefix first, matching lookup order)
  app.get('/api/lifecycle-catalog', { preHandler: requireRole('readonly'), schema: { tags: ['lifecycle'] } },
    async () => {
      const { rows } = await query(
        `SELECT model_prefix, eos_date, eol_date, recommended_release, notes, updated_by, updated_at
         FROM lifecycle_catalog ORDER BY length(model_prefix) DESC, model_prefix`);
      return rows;
    });

  // Create or update a catalog entry (upsert on model_prefix)
  app.put('/api/lifecycle-catalog/:prefix', {
    preHandler: requireRole('superadmin'),
    schema: {
      tags: ['lifecycle'],
      body: {
        type: 'object',
        properties: {
          eosDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
          eolDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
          recommendedRelease: { type: 'string' },
          notes: { type: 'string' }
        }
      }
    }
  }, async (req) => {
    const me = req.user as any;
    const prefix = (req.params as any).prefix as string;
    const b = (req.body as any) ?? {};
    await query(
      `INSERT INTO lifecycle_catalog (model_prefix, eos_date, eol_date, recommended_release, notes, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (model_prefix) DO UPDATE SET
         eos_date=$2, eol_date=$3, recommended_release=$4, notes=$5, updated_by=$6, updated_at=now()`,
      [prefix, b.eosDate || null, b.eolDate || null, b.recommendedRelease ?? '', b.notes ?? '', me.username]);
    invalidateLifecycleCache();
    await audit(me.username, 'lifecycle.upsert', prefix, b, req.ip);
    return { ok: true };
  });

  // Delete a catalog entry
  app.delete('/api/lifecycle-catalog/:prefix', { preHandler: requireRole('superadmin'), schema: { tags: ['lifecycle'] } },
    async (req) => {
      const me = req.user as any;
      const prefix = (req.params as any).prefix as string;
      await query('DELETE FROM lifecycle_catalog WHERE model_prefix=$1', [prefix]);
      invalidateLifecycleCache();
      await audit(me.username, 'lifecycle.delete', prefix, {}, req.ip);
      return { ok: true };
    });
}

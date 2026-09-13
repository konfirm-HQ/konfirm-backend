import { Injectable } from '@nestjs/common';
import { pool } from '../db/pool';

export interface SubmitListingInput {
  kind: 'facilitator' | 'resource';
  name?: string;
  url: string;
  description: string;
  network?: string;
  scheme?: string;
  contact_email?: string;
}

interface ListingRow {
  kind: 'facilitator' | 'resource';
  name: string | null;
  url: string;
  description: string;
  network: string;
  scheme: string;
  extra: { settleUrl?: string; supportedKinds?: unknown[] };
}

@Injectable()
export class BazaarService {
  // The public submission endpoint — anyone can propose a listing, but it
  // lands as 'pending' and never appears in the manifest until an admin
  // approves it (AdminBazaarService). No auth on this endpoint by design,
  // same reasoning as deposits.controller.ts/x402.controller.ts: it's
  // called by parties with no prior relationship to Konfirm.
  async submit(input: SubmitListingInput) {
    const { rows } = await pool.query(
      `INSERT INTO bazaar_listings (kind, name, url, description, network, scheme, contact_email)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'stellar:testnet'), COALESCE($6, 'exact'), $7)
       RETURNING id, kind, status, created_at`,
      [
        input.kind,
        input.name ?? null,
        input.url,
        input.description,
        input.network ?? null,
        input.scheme ?? null,
        input.contact_email ?? null,
      ],
    );
    return rows[0];
  }

  // Generates x402-bazaar.json from approved listings — same schema the
  // static manifest already published, so existing consumers (anything
  // that fetched the old static file) don't see a breaking change, only a
  // manifest that can now grow without a code deploy.
  async getManifest() {
    const { rows } = await pool.query<ListingRow>(
      `SELECT kind, name, url, description, network, scheme, extra
       FROM bazaar_listings WHERE status = 'approved' ORDER BY created_at ASC`,
    );

    const facilitators = rows
      .filter((r) => r.kind === 'facilitator')
      .map((r) => ({
        name: r.name,
        description: r.description,
        verifyUrl: r.url,
        settleUrl: r.extra.settleUrl ?? null,
        supportedKinds: r.extra.supportedKinds ?? [],
      }));

    const resources = rows
      .filter((r) => r.kind === 'resource')
      .map((r) => ({
        url: r.url,
        description: r.description,
        network: r.network,
        scheme: r.scheme,
      }));

    return {
      bazaarVersion: '0.1',
      description:
        'x402 Bazaar discovery manifest, generated from a live registry — submit a listing via POST /bazaar/listings.',
      generatedAt: new Date().toISOString(),
      facilitators,
      resources,
    };
  }
}

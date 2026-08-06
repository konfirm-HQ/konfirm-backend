import { BadRequestException } from '@nestjs/common';
import { Asset } from '@stellar/stellar-sdk';

// Circle's official testnet USDC issuer on Stellar — the same asset every
// Stellar testnet tutorial, wallet, and the reference anchor at
// testanchor.stellar.org all point at, not a placeholder.
export const USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

export function resolveAsset(currency: string): Asset {
  if (currency === 'XLM') return Asset.native();
  if (currency === 'USDC') return new Asset('USDC', USDC_TESTNET_ISSUER);
  throw new BadRequestException(`${currency} is not supported yet`);
}

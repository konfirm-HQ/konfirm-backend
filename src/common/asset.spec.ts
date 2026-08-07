import { BadRequestException } from '@nestjs/common';
import { resolveAsset, USDC_TESTNET_ISSUER } from './asset';

describe('resolveAsset', () => {
  it('resolves XLM to the native asset', () => {
    const asset = resolveAsset('XLM');
    expect(asset.isNative()).toBe(true);
  });

  it('resolves USDC to the real testnet issuer, not a placeholder', () => {
    const asset = resolveAsset('USDC');
    expect(asset.isNative()).toBe(false);
    expect(asset.getCode()).toBe('USDC');
    expect(asset.getIssuer()).toBe(USDC_TESTNET_ISSUER);
  });

  it('rejects a currency with no wired-up asset (e.g. EURC, accepted by validation but not implemented)', () => {
    expect(() => resolveAsset('EURC')).toThrow(BadRequestException);
  });

  it('rejects garbage input rather than defaulting to something plausible-looking', () => {
    expect(() => resolveAsset('not-a-currency')).toThrow(BadRequestException);
  });
});

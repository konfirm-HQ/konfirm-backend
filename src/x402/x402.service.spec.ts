import { Keypair } from '@stellar/stellar-sdk';
import { USDC_TESTNET_ADDRESS, STELLAR_TESTNET_CAIP2 } from '@x402/stellar';
import { X402Service } from './x402.service';

describe('X402Service', () => {
  let service: X402Service;
  const originalEnv = process.env.X402_ALLOWED_ASSETS;
  const secondAssetContract = 'CDDVLE2DZQAYFY3Z2Z74TUNNPC4ROUACSBXOB2P64IT75EZFAQXSRSXY';

  beforeAll(async () => {
    process.env.STELLAR_DEPLOYER_SECRET_KEY = Keypair.random().secret();
    service = new X402Service();
    await service.onModuleInit();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.X402_ALLOWED_ASSETS;
    } else {
      process.env.X402_ALLOWED_ASSETS = originalEnv;
    }
  });

  it('allows USDC by default when X402_ALLOWED_ASSETS is unset', async () => {
    delete process.env.X402_ALLOWED_ASSETS;

    const reqUSDC = {
      scheme: 'exact',
      network: STELLAR_TESTNET_CAIP2,
      asset: USDC_TESTNET_ADDRESS,
      amount: '1000000',
      payTo: 'GBXBABMFZIJPTOFI6STUXA2FMEXDBB4URBD3VS5XDHKMFHGLJZ5WPQBB',
      maxTimeoutSeconds: 60,
      extra: {},
    };

    const resUSDC = await service.verify(2, { x402Version: 2, accepted: reqUSDC, payload: {} }, reqUSDC);
    expect(resUSDC.invalidReason).not.toBe('unsupported_asset');

    const reqOther = {
      ...reqUSDC,
      asset: secondAssetContract,
    };

    const resOther = await service.verify(2, { x402Version: 2, accepted: reqOther, payload: {} }, reqOther);
    expect(resOther.isValid).toBe(false);
    expect(resOther.invalidReason).toBe('unsupported_asset');
  });

  it('allows configured assets when X402_ALLOWED_ASSETS is set', async () => {
    process.env.X402_ALLOWED_ASSETS = `${USDC_TESTNET_ADDRESS}, ${secondAssetContract}`;

    const reqSecond = {
      scheme: 'exact',
      network: STELLAR_TESTNET_CAIP2,
      asset: secondAssetContract,
      amount: '1000000',
      payTo: 'GBXBABMFZIJPTOFI6STUXA2FMEXDBB4URBD3VS5XDHKMFHGLJZ5WPQBB',
      maxTimeoutSeconds: 60,
      extra: {},
    };

    const resSecond = await service.verify(2, { x402Version: 2, accepted: reqSecond, payload: {} }, reqSecond);
    expect(resSecond.invalidReason).not.toBe('unsupported_asset');

    const reqThird = {
      ...reqSecond,
      asset: 'CCW633MKA4EO62LW36C3AQIG32J643O4B37EQ3YRT72ECD2LYOELN3NO',
    };

    const resThird = await service.verify(2, { x402Version: 2, accepted: reqThird, payload: {} }, reqThird);
    expect(resThird.isValid).toBe(false);
    expect(resThird.invalidReason).toBe('unsupported_asset');
  });
});

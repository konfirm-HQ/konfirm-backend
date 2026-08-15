// Ambient shim for `@stellar/stellar-sdk/contract`. Same root cause and
// same fix as `src/x402/x402-stellar-facilitator.d.ts`: this project's
// module resolution (module: commonjs, the classic/node10 resolver —
// required elsewhere since @stellar/stellar-sdk itself is ESM-only and a
// node16/nodenext switch breaks that import project-wide) can't follow
// package.json `exports`-map subpaths for type resolution, even though the
// real .d.ts exists and Node's own runtime `require` resolves the subpath
// fine. Transcribed from the real declarations (@stellar/stellar-sdk@16.2.0,
// lib/esm/contract/{client,assembled_transaction,types}.d.ts), scoped to
// only what onchain-compliance.ts actually uses.
declare module '@stellar/stellar-sdk/contract' {
  export type MethodOptions = {
    fee?: string;
    timeoutInSeconds?: number;
    simulate?: boolean;
    restore?: boolean;
    publicKey?: string;
  };

  export type ClientOptions = MethodOptions & {
    contractId: string;
    networkPassphrase: string;
    rpcUrl: string;
    allowHttp?: boolean;
    headers?: Record<string, string>;
  };

  export class AssembledTransaction<T> {
    readonly result: T;
  }

  export class Client {
    static from<T = unknown>(options: ClientOptions): Promise<Client & T>;
  }
}

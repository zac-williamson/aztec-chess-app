import { getStubAccountContractArtifact, createStubAccount } from '@aztec/accounts/stub/lazy';
import { SchnorrAccountContract } from '@aztec/accounts/schnorr/lazy';

import { getPXEConfig, type PXEConfig } from '@aztec/pxe/config';
import { createPXE, PXE } from '@aztec/pxe/client/lazy';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';
import { mergeExecutionPayloads, type ExecutionPayload, type TxSimulationResult } from '@aztec/stdlib/tx';
import type { DefaultAccountEntrypointOptions } from '@aztec/entrypoints/account';
import { deriveSigningKey } from '@aztec/stdlib/keys';
import { SignerlessAccount, type Account, type AccountContract } from '@aztec/aztec.js/account';
import { AccountManager } from '@aztec/aztec.js/wallet';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { SimulateInteractionOptions } from '@aztec/aztec.js/contracts';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { BaseWallet } from '@aztec/wallet-sdk/base-wallet';

/**
 * Data for generating an account.
 */
export interface AccountData {
  /**
   * Secret to derive the keys for the account.
   */
  secret: Fr;
  /**
   * Contract address salt.
   */
  salt: Fr;
  /**
   * Contract that backs the account.
   */
  contract: AccountContract;
}

export class EmbeddedWallet extends BaseWallet {
  protected accounts: Map<string, Account> = new Map();

  constructor(pxe: PXE, aztecNode: AztecNode) {
    super(pxe, aztecNode);
  }

  static async create(aztecNode: AztecNode) {
    const l1Contracts = await aztecNode.getL1ContractAddresses();
    const rollupAddress = l1Contracts.rollupAddress;

    const config = getPXEConfig();
    config.dataDirectory = `pxe-${rollupAddress}`;
    config.proverEnabled = true;
    const configWithContracts = {
      ...config,
      l1Contracts,
    } as PXEConfig;

    // Check if SharedArrayBuffer is available (required for multithreading)
    // This requires COOP/COEP headers to be set correctly
    const sharedArrayBufferAvailable = typeof SharedArrayBuffer !== 'undefined';
    if (!sharedArrayBufferAvailable) {
      console.warn('SharedArrayBuffer not available - proving will be single-threaded and slow!');
      console.warn('Ensure Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers are set.');
    }

    // Get number of threads for multithreaded proving
    // Use all available cores for maximum performance
    const numThreads = sharedArrayBufferAvailable
      ? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4)
      : 1;

    console.log(`Creating PXE with ${numThreads} threads for proving (SharedArrayBuffer: ${sharedArrayBufferAvailable})`);

    const pxe = await createPXE(aztecNode, configWithContracts);
    return new EmbeddedWallet(pxe, aztecNode);
  }

  async createAccount(accountData?: AccountData): Promise<AccountManager> {
    // Generate random values if not provided
    const secret = accountData?.secret ?? Fr.random();
    const salt = accountData?.salt ?? Fr.random();
    // Use SchnorrAccountContract if not provided
    const contract = accountData?.contract ?? new SchnorrAccountContract(GrumpkinScalar.random());

    const accountManager = await AccountManager.create(this, secret, contract, salt);

    const instance = accountManager.getInstance();
    const artifact = await contract.getContractArtifact();

    await this.registerContract(instance, artifact, secret);

    this.accounts.set(accountManager.address.toString(), await accountManager.getAccount());

    return accountManager;
  }

  protected async getAccountFromAddress(address: AztecAddress): Promise<Account> {
    if (address.equals(AztecAddress.ZERO)) {
      return new SignerlessAccount();
    }

    const account = this.accounts.get(address.toString());
    if (!account) {
      throw new Error(`Account with address ${address.toString()} not found in wallet`);
    }

    return account;
  }

  async getAccounts() {
    if (this.accounts.size === 0) {
      const accountManager = await this.createAccount({
        salt: Fr.ZERO,
        secret: Fr.ZERO,
        contract: new SchnorrAccountContract(deriveSigningKey(Fr.ZERO)),
      });
      const account = await accountManager.getAccount();
      this.accounts.set(accountManager.address.toString(), account);
    }
    return Array.from(this.accounts.values()).map(acc => ({ item: acc.getAddress(), alias: '' }));
  }

  private async getFakeAccountDataFor(address: AztecAddress) {
    const originalAccount = await this.getAccountFromAddress(address);
    const originalAddress = originalAccount.getCompleteAddress();
    const contractInstance = await this.pxe.getContractInstance(originalAddress.address);
    if (!contractInstance) {
      throw new Error(`No contract instance found for address: ${originalAddress.address}`);
    }
    const stubAccount = createStubAccount(originalAddress);
    const StubAccountContractArtifact = await getStubAccountContractArtifact();
    const instance = await getContractInstanceFromInstantiationParams(StubAccountContractArtifact, {
      salt: Fr.random(),
    });
    return {
      account: stubAccount,
      instance,
      artifact: StubAccountContractArtifact,
    };
  }

  override async simulateTx(
    executionPayload: ExecutionPayload,
    opts: SimulateInteractionOptions,
  ): Promise<TxSimulationResult> {
    const feeOptions = opts.fee?.estimateGas
      ? await this.completeFeeOptionsForEstimation(opts.from, executionPayload.feePayer, opts.fee?.gasSettings)
      : await this.completeFeeOptions(opts.from, executionPayload.feePayer, opts.fee?.gasSettings);
    const feeExecutionPayload = await feeOptions.walletFeePaymentMethod?.getExecutionPayload();
    const executionOptions: DefaultAccountEntrypointOptions = {
      txNonce: Fr.random(),
      cancellable: this.cancellableTransactions,
      feePaymentMethodOptions: feeOptions.accountFeePaymentMethodOptions,
    };
    const finalExecutionPayload = feeExecutionPayload
      ? mergeExecutionPayloads([feeExecutionPayload, executionPayload])
      : executionPayload;
    const { account: fromAccount, instance, artifact } = await this.getFakeAccountDataFor(opts.from);
    const chainInfo = await this.getChainInfo();
    const txRequest = await fromAccount.createTxExecutionRequest(
      finalExecutionPayload,
      feeOptions.gasSettings,
      chainInfo,
      executionOptions,
    );
    const contractOverrides = {
      [opts.from.toString()]: { instance, artifact },
    };
    return this.pxe.simulateTx(txRequest, true /* simulatePublic */, true, true, {
      contracts: contractOverrides,
    });
  }
}

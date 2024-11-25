import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import {
  PubkeyString,
  SEND_OPTIONS,
  TransactionSenderAndConfirmationWaiterArgs,
} from 'src/@types';
import { firstValueFrom } from 'rxjs';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  VersionedTransaction,
  VersionedTransactionResponse,
} from '@solana/web3.js';
import {
  QuoteGetRequest,
  QuoteResponse,
  createJupiterApiClient,
  SwapResponse,
  DefaultApi,
} from '@jup-ag/api';
import { getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { Wallet } from '@project-serum/anchor';

@Injectable()
export class JupService {
  private readonly logger = new Logger(JupService.name);
  private readonly connection: Connection;
  private readonly USDC_MINT: PublicKey;
  private readonly feeAccount: PublicKey;
  private readonly trackingAccount: PublicKey;
  private readonly jupiterQuoteApi: DefaultApi;

  constructor(private readonly httpService: HttpService) {
    this.connection = new Connection('https://api.mainnet-beta.solana.com');
    this.USDC_MINT = new PublicKey(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
    this.feeAccount = new PublicKey(
      'FxmGwcJW4fQQboEETbYrfMGKebKdEyW1HXiMMShWXbCj',
    );
    this.trackingAccount = new PublicKey(
      'FxmGwcJW4fQQboEETbYrfMGKebKdEyW1HXiMMShWXbCj',
    );

    this.jupiterQuoteApi = createJupiterApiClient();
  }

  wait = (time: number) => new Promise((resolve) => setTimeout(resolve, time));

  getSignature(transaction: Transaction | VersionedTransaction): string {
    const signature =
      'signature' in transaction
        ? transaction.signature
        : transaction.signatures[0];
    if (!signature) {
      throw new Error(
        'Missing transaction signature, the transaction was not signed by the fee payer',
      );
    }
    return bs58.encode(signature);
  }

  async transactionSenderAndConfirmationWaiter({
    connection,
    serializedTransaction,
    blockhashWithExpiryBlockHeight,
  }: TransactionSenderAndConfirmationWaiterArgs): Promise<VersionedTransactionResponse | null> {
    const txid = await connection.sendRawTransaction(
      serializedTransaction,
      SEND_OPTIONS,
    );

    const controller = new AbortController();
    const abortSignal = controller.signal;

    const abortableResender = async () => {
      while (true) {
        await this.wait(2_000);
        if (abortSignal.aborted) return;
        try {
          await connection.sendRawTransaction(
            serializedTransaction,
            SEND_OPTIONS,
          );
        } catch (e) {
          console.warn(`Failed to resend transaction: ${e}`);
        }
      }
    };

    try {
      abortableResender();
      const lastValidBlockHeight =
        blockhashWithExpiryBlockHeight.lastValidBlockHeight - 150;

      // this would throw TransactionExpiredBlockheightExceededError
      await Promise.race([
        connection.confirmTransaction(
          {
            ...blockhashWithExpiryBlockHeight,
            lastValidBlockHeight,
            signature: txid,
            abortSignal,
          },
          'confirmed',
        ),
        new Promise(async (resolve) => {
          // in case ws socket died
          while (!abortSignal.aborted) {
            await this.wait(2_000);
            const tx = await connection.getSignatureStatus(txid, {
              searchTransactionHistory: false,
            });
            if (tx?.value?.confirmationStatus === 'confirmed') {
              resolve(tx);
            }
          }
        }),
      ]);
    } catch (e) {
      if (e instanceof TransactionExpiredBlockheightExceededError) {
        // we consume this error and getTransaction would return null
        return null;
      } else {
        // invalid state from web3.js
        throw e;
      }
    } finally {
      controller.abort();
    }
  }

  async getQuote(
    baseAddress: PubkeyString,
    quoteAddress: string = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  ): Promise<QuoteResponse> {
    try {
      const AMOUNT = 1000000;

      // auto slippage w/ minimizeSlippage params
      const params: QuoteGetRequest = {
        inputMint: quoteAddress,
        outputMint: baseAddress, // $ISC
        amount: AMOUNT, // 2 USDC
        autoSlippage: true,
        autoSlippageCollisionUsdValue: 1_000,
        maxAutoSlippageBps: 1000, // 10%
        minimizeSlippage: true,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      };

      // get quote
      const quote = await this.jupiterQuoteApi.quoteGet(params);

      if (!quote) {
        throw new Error('unable to quote');
      }
      return quote;
    } catch (error) {
      throw new Error(`Failed to fetch quote: ${error.message}`);
    }
  }

  async getSwapObj(wallet: Wallet, quote: QuoteResponse) {
    // Get serialized transaction
    const swapObj = await this.jupiterQuoteApi.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      },
    });
    return swapObj;
  }

  async flowQuote(baseAddress: PubkeyString) {
    const quote = await this.getQuote(baseAddress);
    console.dir(quote, { depth: null });
  }

  async flowQuoteAndSwap(baseAddress: PubkeyString) {
    const wallet = new Wallet(
      Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY || '')),
    );
    console.log('Wallet:', wallet.publicKey.toBase58());

    const quote = await this.getQuote(baseAddress);
    console.dir(quote, { depth: null });
    const swapObj = await this.getSwapObj(wallet, quote);
    console.dir(swapObj, { depth: null });

    // Serialize the transaction
    const swapTransactionBuf = Buffer.from(swapObj.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Sign the transaction
    transaction.sign([wallet.payer]);
    const signature = this.getSignature(transaction);

    // We first simulate whether the transaction would be successful
    const { value: simulatedTransactionResponse } =
      await this.connection.simulateTransaction(transaction, {
        replaceRecentBlockhash: true,
        commitment: 'processed',
      });
    const { err, logs } = simulatedTransactionResponse;

    if (err) {
      // Simulation error, we can check the logs for more details
      // If you are getting an invalid account error, make sure that you have the input mint account to actually swap from.
      console.error('Simulation Error:');
      console.error({ err, logs });
      return;
    }

    const serializedTransaction = Buffer.from(transaction.serialize());
    const blockhash = transaction.message.recentBlockhash;

    const transactionResponse =
      await this.transactionSenderAndConfirmationWaiter({
        connection: this.connection,
        serializedTransaction,
        blockhashWithExpiryBlockHeight: {
          blockhash,
          lastValidBlockHeight: swapObj.lastValidBlockHeight,
        },
      });

    // If we are not getting a response back, the transaction has not confirmed.
    if (!transactionResponse) {
      console.error('Transaction not confirmed');
      return;
    }

    if (transactionResponse.meta?.err) {
      console.error(transactionResponse.meta?.err);
    }

    console.log(`https://solscan.io/tx/${signature}`);
  }
}

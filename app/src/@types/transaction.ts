import { BlockhashWithExpiryBlockHeight, Connection } from '@solana/web3.js';

export type TransactionSenderAndConfirmationWaiterArgs = {
  connection: Connection;
  serializedTransaction: Buffer;
  blockhashWithExpiryBlockHeight: BlockhashWithExpiryBlockHeight;
};

export const SEND_OPTIONS = {
  skipPreflight: true,
};

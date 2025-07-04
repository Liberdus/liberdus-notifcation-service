/** Same as type AccountsCopy in the shardus core */
export type AccountsCopy = {
  accountId: string
  data: any // eslint-disable-line @typescript-eslint/no-explicit-any
  timestamp: number
  hash: string
  cycleNumber: number
  isGlobal: boolean
}

export interface Account extends AccountsCopy {
  accountType?: AccountType
}

export enum AccountType {
  UserAccount = 'UserAccount',
}

export interface AppReceiptData {
  txId: string
  timestamp: number
  success: boolean
  reason?: string // Can be undefined if the transaction was successful
  from: string
  to?: string // Can be undefined if the transaction is not directed to any account or is directed more than one account
  type: string
  transactionFee: bigint
  additionalInfo?: object // Can add any additional info related to the transaction that are not in the original transaction data
}

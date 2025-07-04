import { Utils as StringUtils } from '@shardus/types'
import CollectorSubscriber from './collectorSubscriber'
import NotificationService from './notificationService'
import { Account, AppReceiptData } from './types'
import { config } from './config'
import { toEthereumAddress } from './transformAddress'

export const AppReceiptDataWsEvent = '/data/appReceipt'

let notificationService: NotificationService

const start = async (): Promise<void> => {
  try {
    notificationService = new NotificationService()

    // Now you can use the notificationService instance to call its methods
    notificationService.start(config.port)
    // notificationService.startTestNotifier(20) // Start sending test notifications every 15 seconds

    const subscriber = new CollectorSubscriber({
      host: config.collectorHost.host,
      port: config.collectorHost.port,
      verbose: true,
      reconnectDelay: 3000,
      maxReconnectAttempts: 5,
    })

    // Register custom data handler
    subscriber.onData((message) => {
      //  console.log('Received data:', message)
      // Add your logic here to process `message.data`

      if (message.event === AppReceiptDataWsEvent) {
        try {
          // const accountData: Account = StringUtils.safeJsonParse(message.data)
          // processAccountData(accountData)
          const appReceipt: AppReceiptData = StringUtils.safeJsonParse(message.data)
          processAppReceiptData(appReceipt)
        } catch (error) {
          console.error('Error processing account data:', error)
        }
      } else {
        console.log(`Received unknown event: ${message.event}`)
      }
    })

    // Connect to the collector server
    subscriber.connect()

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('Triggering SIGINT...')
      console.log('Liberdus Notification Service stopping...')
      subscriber.disconnect()
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      console.log('Triggering SIGTERM...')
      console.log('Liberdus Notification Service stopping...')
      subscriber.disconnect()
      process.exit(0)
    })
  } catch (error) {
    console.error('Error starting subscriber:', error)
  }
}

const processAccountData = async (account: Account): Promise<void> => {
  console.log('Received account data:', {
    accountId: account.accountId,
    timestamp: account.timestamp,
    // Add other relevant account fields you want to log
  })

  const { accountId, timestamp } = account

  const deviceTokens = notificationService.getDevicesForAddress(accountId)

  if (!deviceTokens || deviceTokens.size === 0) {
    return
  }

  const notificationData: Record<string, any> = {
    type: 'transaction',
    to: toEthereumAddress(accountId),
    timestamp,
  }

  let title = ''
  let body = `Transaction to ${accountId}...`

  // Send notifications to all subscribed devices
  const notifications = Array.from(deviceTokens).map((deviceToken) =>
    notificationService.sendNotification(deviceToken, {
      title,
      body,
      data: notificationData,
    })
  )

  await Promise.all(notifications)

  console.log(`Sent ${notifications.length} notifications for transaction to ${accountId}`)
}

const processAppReceiptData = async (appReceipt: AppReceiptData): Promise<void> => {
  // This method will be called by the collector when processing transactions
  try {
    const { to, type, from, timestamp, success, additionalInfo } = appReceipt
    if (!success) {
      return
    }
    const deviceTokens = notificationService.getDevicesForAddress(to)

    if (!deviceTokens || deviceTokens.size === 0) {
      return
    }

    let title: string
    let body: string

    if (type === 'message') {
      title = '📬 New Message'
      body = `📧 You have a new message from ${toEthereumAddress(from)}.`
    } else if (type === 'transfer') {
      title = '💳 Payment Received'
      const amount = 'amount' in additionalInfo ? (Number(additionalInfo.amount) / 1e18).toString() : ''
      body = `💰 You received ${amount} LIB from ${toEthereumAddress(from)}.`
      console.log(
        additionalInfo,
        amount,
        'amount' in additionalInfo && (additionalInfo.amount as bigint) / BigInt(1e18),
        'amount' in additionalInfo && Number((additionalInfo.amount as bigint) / BigInt(1e18)),
        'amount' in additionalInfo && Number((additionalInfo.amount as bigint) / BigInt(1e18)).toString()
      )
    } else {
      // title = 'New Transaction'
      // body = `Transaction from ${from?.substring(0, 8)}...`
      return
    }

    // Determine notification type and content
    const notificationData: Record<string, any> = {
      type,
      from: toEthereumAddress(from),
      timestamp: new Date(timestamp).toISOString(),
    }

    // Send notifications to all subscribed devices
    const notifications = Array.from(deviceTokens).map((deviceToken) =>
      notificationService.sendNotification(deviceToken, {
        title,
        body,
        data: notificationData,
      })
    )

    await Promise.all(notifications)

    console.log(`Sent ${notifications.length} notifications for transaction to ${toEthereumAddress(to)}`)
  } catch (error) {
    console.error('Error processing transaction for notifications:', error)
  }
}

start()

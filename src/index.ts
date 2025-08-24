import { Utils as StringUtils } from '@shardus/types'
import CollectorSubscriber from './collectorSubscriber'
import NotificationService from './notificationService'
import { AppReceiptData, Transaction } from './types'
import { config } from './config'
import { toEthereumAddress } from './transformAddress'

export const AppReceiptDataWsEvent = '/data/appReceipt'
export const TransactionDataWsEvent = '/data/transaction'

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
      reconnectDelay: config.collectorHost.reconnectDelay,
      maxReconnectAttempts: config.collectorHost.maxReconnectAttempts,
      subscriptionTypes: [TransactionDataWsEvent],
    })

    // Register custom data handler
    subscriber.onData((message) => {
      //  console.log('Received data:', message)
      // Add your logic here to process `message.data`

      if (message.event === AppReceiptDataWsEvent || message.event === TransactionDataWsEvent) {
        try {
          const data = StringUtils.safeJsonParse(message.data)
          processTransactionReceiptData(data)
        } catch (error) {
          console.error('Error processing ${message.event} :', error)
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

const processTransactionReceiptData = async (data: Transaction | AppReceiptData): Promise<void> => {
  try {
    const appReceipt = (data as Transaction).data || (data as AppReceiptData)
    if (!appReceipt) {
      console.error('Error processing data: appReceipt not found')
      return
    }
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
    let sendCallNotification = false

    if (type === 'message') {
      title = '📬 New Message'
      body = `📧 You have a new message from ${toEthereumAddress(from)} to ${toEthereumAddress(to)}`
      // If it's the transaction data, check if it's a callType from originalTxData
      if ((data as Transaction).originalTxData) {
        const originalTxData = (data as Transaction).originalTxData?.tx
        if (originalTxData && 'callType' in originalTxData && originalTxData.callType === true) {
          sendCallNotification = true
        }
      }
    } else if (type === 'transfer') {
      title = '💳 Payment Received'
      const amount = 'amount' in additionalInfo ? (Number(additionalInfo.amount) / 1e18).toString() : ''
      body = `💰 You received ${amount} LIB from ${toEthereumAddress(from)} to ${toEthereumAddress(to)}`
    } else {
      // title = 'New Transaction'
      // body = `Transaction from ${from?.substring(0, 8)}...`
      return
    }

    // Determine notification type and content
    const notificationData: Record<string, any> = {
      type,
      from: toEthereumAddress(from),
      to: toEthereumAddress(to),
      timestamp: new Date(timestamp).toISOString(),
    }

    // Send notifications to all subscribed devices
    const notifications = Array.from(deviceTokens).map((deviceToken) =>
      notificationService.sendNotification(
        deviceToken,
        {
          title,
          body,
          data: notificationData,
        },
        sendCallNotification
      )
    )

    await Promise.all(notifications)

    console.log(`Sent ${notifications.length} notifications for ${type} to ${toEthereumAddress(to)}`)
  } catch (error) {
    console.error('Error processing transaction for notifications:', error)
  }
}

start()

import express, { Request, Response, NextFunction } from 'express'
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import cors from 'cors'
import { promises as fs } from 'fs'
import path from 'path'
import { isShardusAddress } from './transformAddress'

// Type definitions
interface SubscriptionRequest {
  deviceToken: string
  addresses: string[]
  expoPushToken: string
}

interface TestNotificationRequest {
  deviceToken: string
  title?: string
  body?: string
  data?: Record<string, any>
}

interface Subscription {
  addresses: Set<string>
  expoPushToken: string | null
  createdAt: string
}

interface SubscriptionData {
  addresses: string[]
  expoPushToken: string | null
  createdAt: string
}

interface SavedSubscriptions {
  subscriptions: Record<string, SubscriptionData>
  lastUpdated: string
}

interface NotificationPayload {
  title: string
  body: string
  data?: Record<string, any>
}

interface NotificationResult {
  success: boolean
  error?: string
  ticket?: ExpoPushTicket
}

interface ApiResponse {
  success: boolean
  message: string
  timestamp: string
  [key: string]: any
}

interface ErrorResponse {
  error: string
  code: string
  message?: string
}

interface HealthResponse {
  status: string
  timestamp: string
  subscriptions: number
  monitoredAddresses: number
}

interface SubscriptionInfo {
  deviceToken: string
  addresses: string[]
  hasExpoPushToken: boolean
  timestamp: string
}

interface SubscriptionListResponse {
  subscriptions: Array<{
    deviceToken: string
    addresses: string[]
    hasExpoPushToken: boolean
  }>
  total: number
  timestamp: string
}

class LiberdusNotificationService {
  private app: express.Application
  private expo: Expo
  private subscriptions: Map<string, Subscription>
  private addressToDevices: Map<string, Set<string>>
  private dataFile: string

  constructor() {
    this.app = express()
    this.expo = new Expo()
    this.subscriptions = new Map<string, Subscription>()
    this.addressToDevices = new Map<string, Set<string>>()
    this.dataFile = path.resolve(__dirname, '..', 'subscriptions.json')
    this.setupMiddleware()
    this.setupRoutes()
    this.loadSubscriptions()
  }

  private setupMiddleware(): void {
    this.app.use(cors())
    this.app.use(express.json())
    this.app.use(express.urlencoded({ extended: true }))

    // Logging middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
      next()
    })
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response<HealthResponse>) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        subscriptions: this.subscriptions.size,
        monitoredAddresses: this.addressToDevices.size,
      })
    })

    // Subscribe endpoint
    this.app.post(
      '/subscribe',
      async (
        req: Request<{}, ApiResponse | ErrorResponse, SubscriptionRequest>,
        res: Response<ApiResponse | ErrorResponse>
      ) => {
        try {
          const { deviceToken, addresses, expoPushToken } = req.body

          // Validate required fields
          if (!deviceToken) {
            return res.status(400).json({
              error: 'Device token is required',
              code: 'MISSING_DEVICE_TOKEN',
            })
          }

          if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
            return res.status(400).json({
              error: 'Addresses array is required and must not be empty',
              code: 'MISSING_ADDRESSES',
            })
          }

          for (const address of addresses) {
            if (!isShardusAddress(address)) {
              return res.status(400).json({
                error: 'Invalid address format, expected shardus address',
                code: 'INVALID_ADDRESS',
              })
            }
          }

          const DUMMY_ADDRESS = '0'.repeat(64)
          if (addresses.includes(DUMMY_ADDRESS)) {
            // If dummy address is included, remove the subscription of the device
            await this.removeSubscription(deviceToken)
            return res.json({
              success: true,
              message: 'Subscription removed successfully',
              deviceToken,
              timestamp: new Date().toISOString(),
            })
          }

          // Validate Expo push token if provided
          if (!expoPushToken || !Expo.isExpoPushToken(expoPushToken)) {
            return res.status(400).json({
              error: 'Invalid Expo push token format',
              code: 'INVALID_EXPO_TOKEN',
            })
          }

          // Process subscription
          await this.addSubscription(deviceToken, addresses, expoPushToken)

          console.log(`Subscription added for device: ${deviceToken}`)
          console.log(`Monitoring addresses: ${addresses.join(', ')}`)

          res.json({
            success: true,
            message: 'Subscription added successfully',
            deviceToken,
            addressCount: addresses.length,
            timestamp: new Date().toISOString(),
          })
        } catch (error) {
          console.error('Error processing subscription:', error)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          res.status(500).json({
            error: 'Internal server error',
            code: 'SUBSCRIPTION_ERROR',
            message: errorMessage,
          })
        }
      }
    )

    // Get subscription info
    this.app.get(
      '/subscription/:deviceToken',
      (req: Request<{ deviceToken: string }>, res: Response<SubscriptionInfo | ErrorResponse>) => {
        const { deviceToken } = req.params
        const subscription = this.subscriptions.get(deviceToken)

        if (!subscription) {
          return res.status(404).json({
            error: 'Subscription not found',
            code: 'SUBSCRIPTION_NOT_FOUND',
          })
        }

        res.json({
          deviceToken,
          addresses: Array.from(subscription.addresses),
          hasExpoPushToken: !!subscription.expoPushToken,
          timestamp: new Date().toISOString(),
        })
      }
    )

    // List all subscriptions (for debugging)
    this.app.get('/subscriptions', (req: Request, res: Response<SubscriptionListResponse>) => {
      const subscriptionList = Array.from(this.subscriptions.entries()).map(([deviceToken, sub]) => ({
        deviceToken,
        addresses: Array.from(sub.addresses),
        hasExpoPushToken: !!sub.expoPushToken,
      }))

      res.json({
        subscriptions: subscriptionList,
        total: subscriptionList.length,
        timestamp: new Date().toISOString(),
      })
    })

    // Test notification endpoint (for development)
    this.app.post(
      '/test-notification',
      async (
        req: Request<{}, ApiResponse | ErrorResponse, TestNotificationRequest>,
        res: Response<ApiResponse | ErrorResponse>
      ) => {
        try {
          const { deviceToken, title, body, data } = req.body

          if (!deviceToken) {
            return res.status(400).json({
              error: 'Device token is required',
              code: 'MISSING_DEVICE_TOKEN',
            })
          }

          const result = await this.sendNotification(deviceToken, {
            title: title || 'Test Notification',
            body: body || 'This is a test notification',
            data: data || { test: true },
          })

          res.json({
            success: true,
            message: 'Test notification sent',
            result,
            timestamp: new Date().toISOString(),
          })
        } catch (error) {
          console.error('Error sending test notification:', error)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          res.status(500).json({
            error: 'Failed to send test notification',
            message: errorMessage,
            code: 'TEST_NOTIFICATION_FAILED', // or some other error code
          })
        }
      }
    )

    // Broadcast notification to all subscribed devices
    this.app.get('/broadcast', async (req: Request, res: Response) => {
      try {
        await this.sendTestNotificationToAll()

        res.json({
          success: true,
          message: 'Broadcast notification sent to all subscribed devices',
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        console.error('❌ Broadcast failed:', error)
        res.status(500).json({
          success: false,
          error: 'Failed to send broadcast',
        })
      }
    })
  }

  private async addSubscription(
    deviceToken: string,
    addresses: string[],
    expoPushToken: string
  ): Promise<void> {
    // If any of the provided addresses already maps to another device with the same Expo push token,
    // unlink the old devices first
    this.unlinkOldDevices(deviceToken, addresses, expoPushToken)
    // Remove existing subscription if it exists
    await this.removeSubscription(deviceToken)

    // Create new subscription
    const addressSet = new Set(addresses.map((addr) => addr.toLowerCase()))
    this.subscriptions.set(deviceToken, {
      addresses: addressSet,
      expoPushToken,
      createdAt: new Date().toISOString(),
    })

    // Update address-to-device mapping
    for (const address of addressSet) {
      if (!this.addressToDevices.has(address)) {
        this.addressToDevices.set(address, new Set())
      }
      this.addressToDevices.get(address)!.add(deviceToken)
    }

    // Persist to file
    await this.saveSubscriptions()
  }

  private unlinkOldDevices(deviceToken: string, addresses: string[], expoPushToken: string): void {
    for (const address of addresses.map((addr) => addr.toLowerCase())) {
      const existingDevices = this.addressToDevices.get(address)
      if (existingDevices) {
        for (const otherDevice of existingDevices) {
          if (otherDevice !== deviceToken) {
            const otherSub = this.subscriptions.get(otherDevice)
            if (otherSub && otherSub.expoPushToken === expoPushToken) {
              console.log(`Reassigning address ${address} from device ${otherDevice} to ${deviceToken}`)

              // Remove address from old device
              otherSub.addresses.delete(address)

              // Remove mapping from addressToDevices if no more addresses on old device
              if (otherSub.addresses.size === 0) {
                this.subscriptions.delete(otherDevice)
              }

              // Remove oldDevice from addressToDevices
              existingDevices.delete(otherDevice)
              if (existingDevices.size === 0) {
                this.addressToDevices.delete(address)
              }
            }
          }
        }
      }
    }
  }

  private async removeSubscription(deviceToken: string): Promise<void> {
    const subscription = this.subscriptions.get(deviceToken)
    if (!subscription) {
      return
    }

    // Remove from address-to-device mapping
    for (const address of subscription.addresses) {
      const devices = this.addressToDevices.get(address)
      if (devices) {
        devices.delete(deviceToken)
        if (devices.size === 0) {
          this.addressToDevices.delete(address)
        }
      }
    }

    // Remove subscription
    this.subscriptions.delete(deviceToken)

    // Persist to file
    await this.saveSubscriptions()
  }

  // getters for tokens
  getDevicesForAddress(address: string): Set<string> {
    return this.addressToDevices.get(address) || new Set<string>()
  }

  public async sendNotification(
    deviceToken: string,
    notification: NotificationPayload
  ): Promise<NotificationResult> {
    try {
      const subscription = this.subscriptions.get(deviceToken)
      if (!subscription) {
        console.warn(`No subscription found for device token: ${deviceToken}`)
        return { success: false, error: 'No subscription found' }
      }

      if (!subscription.expoPushToken) {
        console.warn(`No Expo push token for device: ${deviceToken}`)
        return { success: false, error: 'No Expo push token' }
      }

      const message: ExpoPushMessage = {
        to: subscription.expoPushToken,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
      }

      const tickets = await this.expo.sendPushNotificationsAsync([message])

      if (tickets.length === 0) {
        console.warn(`No tickets returned for device: ${deviceToken}`)
        return { success: false, error: 'No tickets returned' }
      }

      if (tickets[0].status === 'error') {
        console.error(`Error sending notification to device ${deviceToken}:`, tickets[0].message)
        return { success: false, error: tickets[0].message || 'Unknown error' }
      }

      console.log(`Notification sent to device ${deviceToken}:`, tickets)

      return { success: true, ticket: tickets[0] }
    } catch (error) {
      console.error(`Error sending notification to device ${deviceToken}:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: errorMessage }
    }
  }

  private async sendTestNotificationToAll(): Promise<void> {
    const allTokens = Array.from(this.subscriptions.keys())

    for (const deviceToken of allTokens) {
      const result = await this.sendNotification(deviceToken, {
        title: '⏰ Test Notification',
        body: `Ping from server at ${new Date().toLocaleTimeString()}`,
        data: { type: 'server-test', timestamp: new Date().toISOString() },
      })

      if (!result.success) {
        console.warn(`⚠️ Failed to notify ${deviceToken}: ${result.error}`)
      }
    }

    console.log(`✅ Sent test notifications to ${allTokens.length} devices`)
  }

  private async loadSubscriptions(): Promise<void> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8')
      const saved: SavedSubscriptions = JSON.parse(data)

      // Restore subscriptions
      for (const [deviceToken, subscription] of Object.entries(saved.subscriptions || {})) {
        this.subscriptions.set(deviceToken, {
          addresses: new Set(subscription.addresses),
          expoPushToken: subscription.expoPushToken,
          createdAt: subscription.createdAt,
        })
      }

      // Rebuild address-to-device mapping
      for (const [deviceToken, subscription] of this.subscriptions.entries()) {
        for (const address of subscription.addresses) {
          if (!this.addressToDevices.has(address)) {
            this.addressToDevices.set(address, new Set())
          }
          this.addressToDevices.get(address)!.add(deviceToken)
        }
      }

      console.log(`Loaded ${this.subscriptions.size} subscriptions from file`)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        console.log('No existing subscriptions file found, starting fresh')
      } else {
        console.error('Error loading subscriptions:', error)
      }
    }
  }

  private async saveSubscriptions(): Promise<void> {
    try {
      const data: SavedSubscriptions = {
        subscriptions: {},
        lastUpdated: new Date().toISOString(),
      }

      for (const [deviceToken, subscription] of this.subscriptions.entries()) {
        data.subscriptions[deviceToken] = {
          addresses: Array.from(subscription.addresses),
          expoPushToken: subscription.expoPushToken,
          createdAt: subscription.createdAt,
        }
      }

      await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2))
      console.log('Subscriptions saved to file')
    } catch (error) {
      console.error('Error saving subscriptions:', error)
    }
  }

  public startTestNotifier(intervalS: number): void {
    setInterval(async () => {
      console.log('🔁 Sending test notification to all subscribed devices...')
      await this.sendTestNotificationToAll()
    }, intervalS * 1000)
  }

  public start(port: number): void {
    this.app.listen(port, '0.0.0.0', () => {
      console.log(`Liberdus Notification Service running on http://localhost:${port}`)
      console.log(`Health check: http://localhost:${port}/health`)
      console.log(`Current subscriptions: ${this.subscriptions.size}`)
    })
  }
}

// Export for use in other modules
export default LiberdusNotificationService

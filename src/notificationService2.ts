import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import { promises as fs } from 'fs'
import path from 'path'
import { isShardusAddress } from './transformAddress'
import * as admin from 'firebase-admin'
import * as apn from 'node-apn'

// Firebase Admin SDK types (would require: npm install firebase-admin)
interface FirebaseMessage {
  token: string
  notification?: {
    title: string
    body: string
  }
  data?: Record<string, string>
  apns?: {
    headers?: Record<string, string>
    payload?: {
      aps: {
        alert?: {
          title?: string
          body?: string
        }
        badge?: number
        sound?: string
        'content-available'?: number
      }
    }
  }
}

// VoIP Push notification payload interface
interface VoIPPayload {
  aps: {
    alert?: {
      title: string
      body: string
    }
    badge?: number
    sound?: string
    'content-available': number
  }
  callId?: string
  callerName?: string
  callType?: 'audio' | 'video'
}

// Type definitions
interface SubscriptionRequest {
  deviceToken: string
  addresses: string[]
  fcmToken?: string
  voipToken?: string
  platform: 'ios' | 'android'
}

interface TestNotificationRequest {
  deviceToken: string
  title?: string
  body?: string
  data?: Record<string, any>
  type?: 'push' | 'voip'
}

interface Subscription {
  addresses: Set<string>
  fcmToken: string | null
  voipToken: string | null
  platform: 'ios' | 'android'
  createdAt: string
}

interface SubscriptionData {
  addresses: string[]
  fcmToken: string | null
  voipToken: string | null
  platform: 'ios' | 'android'
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
  messageId?: string
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
  firebaseEnabled: boolean
  voipEnabled: boolean
}

class LiberdusNotificationService {
  private app: express.Application
  private subscriptions: Map<string, Subscription>
  private addressToDevices: Map<string, Set<string>>
  private dataFile: string
  private firebaseApp: admin.app.App | null
  private apnProvider: apn.Provider | null
  private voipEnabled: boolean

  constructor() {
    this.app = express()
    this.subscriptions = new Map<string, Subscription>()
    this.addressToDevices = new Map<string, Set<string>>()
    this.dataFile = path.resolve(__dirname, '..', 'subscriptions2.json')
    this.firebaseApp = null
    this.apnProvider = null
    this.voipEnabled = process.env.VOIP_ENABLED === 'true'
    
    this.initializeFirebase()
    this.setupMiddleware()
    this.setupRoutes()
    this.loadSubscriptions()
  }

  private initializeFirebase(): void {
    try {
      const serviceAccountPath = path.resolve(__dirname, '..', 'service-account.json')
      const serviceAccount = require(serviceAccountPath)
      
      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      })
      
      console.log('Firebase Admin SDK initialized successfully')
      
      // Initialize VoIP (APN) provider if enabled
      if (this.voipEnabled) {
        const certPath = path.resolve(__dirname, '..', 'voip_services.cer')
        this.apnProvider = new apn.Provider({
          cert: certPath,
          production: process.env.NODE_ENV === 'production'
        })
        console.log('APN Provider initialized for VoIP')
      }
    } catch (error) {
      console.error('Failed to initialize Firebase/APN:', error)
      this.firebaseApp = null
      this.apnProvider = null
    }
  }

  private setupMiddleware(): void {
    this.app.use(cors())
    this.app.use(express.json())
    this.app.use(express.urlencoded({ extended: true }))

    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
      next()
    })
  }

  private setupRoutes(): void {
    this.app.get('/health', (req: Request, res: Response<HealthResponse>) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        subscriptions: this.subscriptions.size,
        monitoredAddresses: this.addressToDevices.size,
        firebaseEnabled: !!this.firebaseApp,
        voipEnabled: this.voipEnabled,
      })
    })

    this.app.post(
      '/subscribe',
      async (
        req: Request<{}, ApiResponse | ErrorResponse, SubscriptionRequest>,
        res: Response<ApiResponse | ErrorResponse>
      ) => {
        try {
          const { deviceToken, addresses, fcmToken, voipToken, platform } = req.body

          if (!deviceToken) {
            return res.status(400).json({
              error: 'Device token is required',
              code: 'MISSING_DEVICE_TOKEN',
            })
          }

          if (!addresses || !Array.isArray(addresses)) {
            return res.status(400).json({
              error: 'Addresses array is required',
              code: 'MISSING_ADDRESSES_ARRAY',
            })
          }

          if (!platform || !['ios', 'android'].includes(platform)) {
            return res.status(400).json({
              error: 'Platform must be ios or android',
              code: 'INVALID_PLATFORM',
            })
          }

          if (addresses.length === 0) {
            await this.removeSubscription(deviceToken)
            console.log(`Subscription removed for device: ${deviceToken}`)
            return res.json({
              success: true,
              message: 'Subscription removed successfully',
              deviceToken,
              timestamp: new Date().toISOString(),
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

          if (!fcmToken && !voipToken) {
            return res.status(400).json({
              error: 'Either FCM token or VoIP token is required',
              code: 'MISSING_TOKENS',
            })
          }

          await this.addSubscription(deviceToken, addresses, fcmToken, voipToken, platform)

          console.log(`Subscription added for device: ${deviceToken}`)
          console.log(`Platform: ${platform}, FCM: ${!!fcmToken}, VoIP: ${!!voipToken}`)
          console.log(`Monitoring addresses: ${addresses.join(', ')}`)

          res.json({
            success: true,
            message: 'Subscription added successfully',
            deviceToken,
            platform,
            addressCount: addresses.length,
            hasFcmToken: !!fcmToken,
            hasVoipToken: !!voipToken,
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

    this.app.post(
      '/test-notification',
      async (
        req: Request<{}, ApiResponse | ErrorResponse, TestNotificationRequest>,
        res: Response<ApiResponse | ErrorResponse>
      ) => {
        try {
          const { deviceToken, title, body, data, type = 'push' } = req.body

          if (!deviceToken) {
            return res.status(400).json({
              error: 'Device token is required',
              code: 'MISSING_DEVICE_TOKEN',
            })
          }

          const notification = {
            title: title || 'Test Notification',
            body: body || 'This is a test notification from Firebase/VoIP',
            data: data || { test: true },
          }

          let result: NotificationResult
          if (type === 'voip') {
            result = await this.sendVoIPNotification(deviceToken, notification)
          } else {
            result = await this.sendFirebaseNotification(deviceToken, notification)
          }

          res.json({
            success: true,
            message: `Test ${type} notification sent`,
            result,
            timestamp: new Date().toISOString(),
          })
        } catch (error) {
          console.error('Error sending test notification:', error)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          res.status(500).json({
            error: 'Failed to send test notification',
            message: errorMessage,
            code: 'TEST_NOTIFICATION_FAILED',
          })
        }
      }
    )

    this.app.post('/broadcast', async (req: Request, res: Response) => {
      try {
        await this.sendTestNotificationToAll()

        res.json({
          success: true,
          message: 'Broadcast notifications sent to all subscribed devices',
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
    fcmToken: string | null,
    voipToken: string | null,
    platform: 'ios' | 'android'
  ): Promise<void> {
    this.unlinkOldDevices(deviceToken, addresses, fcmToken, voipToken)
    await this.removeSubscription(deviceToken)

    const addressSet = new Set(addresses.map((addr) => addr.toLowerCase()))
    this.subscriptions.set(deviceToken, {
      addresses: addressSet,
      fcmToken,
      voipToken,
      platform,
      createdAt: new Date().toISOString(),
    })

    for (const address of addressSet) {
      if (!this.addressToDevices.has(address)) {
        this.addressToDevices.set(address, new Set())
      }
      this.addressToDevices.get(address)!.add(deviceToken)
    }

    await this.saveSubscriptions()
  }

  private unlinkOldDevices(
    deviceToken: string,
    addresses: string[],
    fcmToken: string | null,
    voipToken: string | null
  ): void {
    for (const address of addresses.map((addr) => addr.toLowerCase())) {
      const existingDevices = this.addressToDevices.get(address)
      if (existingDevices) {
        for (const otherDevice of existingDevices) {
          if (otherDevice !== deviceToken) {
            const otherSub = this.subscriptions.get(otherDevice)
            if (otherSub && (otherSub.fcmToken === fcmToken || otherSub.voipToken === voipToken)) {
              console.log(`Reassigning address ${address} from device ${otherDevice} to ${deviceToken}`)

              otherSub.addresses.delete(address)

              if (otherSub.addresses.size === 0) {
                this.subscriptions.delete(otherDevice)
              }

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

    for (const address of subscription.addresses) {
      const devices = this.addressToDevices.get(address)
      if (devices) {
        devices.delete(deviceToken)
        if (devices.size === 0) {
          this.addressToDevices.delete(address)
        }
      }
    }

    this.subscriptions.delete(deviceToken)
    await this.saveSubscriptions()
  }

  getDevicesForAddress(address: string): Set<string> {
    return this.addressToDevices.get(address) || new Set<string>()
  }

  public async sendNotification(
    deviceToken: string,
    notification: NotificationPayload,
    type: 'push' | 'voip' = 'push'
  ): Promise<NotificationResult> {
    if (type === 'voip') {
      return this.sendVoIPNotification(deviceToken, notification)
    } else {
      return this.sendFirebaseNotification(deviceToken, notification)
    }
  }

  private async sendFirebaseNotification(
    deviceToken: string,
    notification: NotificationPayload
  ): Promise<NotificationResult> {
    try {
      const subscription = this.subscriptions.get(deviceToken)
      if (!subscription) {
        console.warn(`No subscription found for device token: ${deviceToken}`)
        return { success: false, error: 'No subscription found' }
      }

      if (!subscription.fcmToken) {
        console.warn(`No FCM token for device: ${deviceToken}`)
        return { success: false, error: 'No FCM token' }
      }

      const message: FirebaseMessage = {
        token: subscription.fcmToken,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: this.convertDataToStrings(notification.data || {}),
      }

      // iOS-specific configuration
      if (subscription.platform === 'ios') {
        message.apns = {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.body,
              },
              badge: 1,
              sound: 'default',
              'content-available': 1,
            },
          },
        }
      }

      if (!this.firebaseApp) {
        console.warn('Firebase not initialized')
        return { success: false, error: 'Firebase not initialized' }
      }

      const messaging = this.firebaseApp.messaging()
      const response = await messaging.send(message)
      
      console.log(`Firebase notification sent to device ${deviceToken}, messageId: ${response}`)
      return { success: true, messageId: response }
    } catch (error) {
      console.error(`Error sending Firebase notification to device ${deviceToken}:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: errorMessage }
    }
  }

  private async sendVoIPNotification(
    deviceToken: string,
    notification: NotificationPayload
  ): Promise<NotificationResult> {
    try {
      const subscription = this.subscriptions.get(deviceToken)
      if (!subscription) {
        console.warn(`No subscription found for device token: ${deviceToken}`)
        return { success: false, error: 'No subscription found' }
      }

      if (!subscription.voipToken) {
        console.warn(`No VoIP token for device: ${deviceToken}`)
        return { success: false, error: 'No VoIP token' }
      }

      if (subscription.platform !== 'ios') {
        console.warn(`VoIP notifications only supported on iOS`)
        return { success: false, error: 'VoIP only supported on iOS' }
      }

      if (!this.apnProvider) {
        console.warn('APN Provider not initialized')
        return { success: false, error: 'APN Provider not initialized' }
      }

      const payload = {
        aps: {
          alert: {
            title: notification.title,
            body: notification.body,
          },
          badge: 1,
          sound: 'default',
          'content-available': 1,
        },
        callId: notification.data?.callId || `call_${Date.now()}`,
        callerName: notification.data?.callerName || 'Liberdus',
        callType: notification.data?.callType || 'audio',
      }

      const voipNotification = new apn.Notification(payload)
      voipNotification.topic = process.env.VOIP_BUNDLE_ID || 'com.liberdus.app.voip'
      
      const result = await this.apnProvider.send(voipNotification, subscription.voipToken)
      
      if (result.failed && result.failed.length > 0) {
        const error = result.failed[0].error
        const failureReason = error instanceof Error ? error.message : (result.failed[0].status || 'Unknown error')
        console.error(`VoIP notification failed: ${failureReason}`)
        return { success: false, error: failureReason }
      }

      console.log(`VoIP notification sent to device ${deviceToken}`)
      return { success: true, messageId: `voip_${Date.now()}` }
    } catch (error) {
      console.error(`Error sending VoIP notification to device ${deviceToken}:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: errorMessage }
    }
  }

  private convertDataToStrings(data: Record<string, any>): Record<string, string> {
    const stringData: Record<string, string> = {}
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = typeof value === 'string' ? value : JSON.stringify(value)
    }
    return stringData
  }

  private async sendTestNotificationToAll(): Promise<void> {
    const allTokens = Array.from(this.subscriptions.keys())

    for (const deviceToken of allTokens) {
      const subscription = this.subscriptions.get(deviceToken)
      if (!subscription) continue

      // Send Firebase notification if available
      if (subscription.fcmToken) {
        const firebaseResult = await this.sendFirebaseNotification(deviceToken, {
          title: '🔥 Firebase Test',
          body: `Firebase ping from server at ${new Date().toLocaleTimeString()}`,
          data: { type: 'firebase-test', timestamp: new Date().toISOString() },
        })

        if (!firebaseResult.success) {
          console.warn(`⚠️ Firebase notification failed for ${deviceToken}: ${firebaseResult.error}`)
        }
      }

      // Send VoIP notification if available (iOS only)
      if (subscription.voipToken && subscription.platform === 'ios') {
        const voipResult = await this.sendVoIPNotification(deviceToken, {
          title: '📞 VoIP Test',
          body: `VoIP ping from server at ${new Date().toLocaleTimeString()}`,
          data: { 
            type: 'voip-test', 
            timestamp: new Date().toISOString(),
            callId: `test_${Date.now()}`,
            callerName: 'Test Server'
          },
        })

        if (!voipResult.success) {
          console.warn(`⚠️ VoIP notification failed for ${deviceToken}: ${voipResult.error}`)
        }
      }
    }

    console.log(`✅ Sent test notifications to ${allTokens.length} devices`)
  }

  private async loadSubscriptions(): Promise<void> {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8')
      const saved: SavedSubscriptions = JSON.parse(data)

      for (const [deviceToken, subscription] of Object.entries(saved.subscriptions || {})) {
        this.subscriptions.set(deviceToken, {
          addresses: new Set(subscription.addresses),
          fcmToken: subscription.fcmToken,
          voipToken: subscription.voipToken,
          platform: subscription.platform,
          createdAt: subscription.createdAt,
        })
      }

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
          fcmToken: subscription.fcmToken,
          voipToken: subscription.voipToken,
          platform: subscription.platform,
          createdAt: subscription.createdAt,
        }
      }

      await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2))
      console.log('Subscriptions saved to file')
    } catch (error) {
      console.error('Error saving subscriptions:', error)
    }
  }

  public start(port: number): void {
    this.app.listen(port, '0.0.0.0', () => {
      console.log(`Liberdus Notification Server 2 (Firebase/VoIP) running on http://localhost:${port}`)
      console.log(`Health check: http://localhost:${port}/health`)
      console.log(`Current subscriptions: ${this.subscriptions.size}`)
      console.log(`Firebase enabled: ${!!this.firebaseApp}`)
      console.log(`VoIP enabled: ${this.voipEnabled}`)
    })
  }
}

export default LiberdusNotificationService
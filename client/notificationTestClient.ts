import axios from 'axios'

// Type definitions for API responses
interface HealthResponse {
  status: string
  timestamp: string
  subscriptions: number
  monitoredAddresses: number
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

interface SubscriptionRequest {
  deviceToken: string
  addresses: string[]
  expoPushToken?: string
}

interface TestNotificationRequest {
  deviceToken: string
  title?: string
  body?: string
  data?: Record<string, any>
}

// Test client for the Liberdus Notification Service
class NotificationTestClient {
  private baseUrl: string

  constructor(baseUrl: string = 'http://192.168.1.91:3001') {
    this.baseUrl = baseUrl
  }

  async testHealthCheck(): Promise<boolean> {
    try {
      console.log('Testing health check...')
      const response = await axios.get<HealthResponse>(`${this.baseUrl}/health`)
      console.log('✅ Health check passed:', response.data)
      return true
    } catch (error) {
      console.error('❌ Health check failed:', this.getErrorMessage(error))
      return false
    }
  }

  async testSubscription(): Promise<boolean> {
    try {
      console.log('\nTesting subscription...')

      const subscriptionData: SubscriptionRequest = {
        deviceToken: 'test-device-token-123',
        addresses: [
          '0x1234567890abcdef1234567890abcdef12345678',
          '0xabcdef1234567890abcdef1234567890abcdef12',
        ],
        expoPushToken: 'ExponentPushToken[test-expo-token-456]',
      }

      const response = await axios.post<ApiResponse>(`${this.baseUrl}/subscribe`, subscriptionData)
      console.log('✅ Subscription successful:', response.data)
      return true
    } catch (error) {
      console.error('❌ Subscription failed:', this.getErrorResponse(error))
      return false
    }
  }

  async testGetSubscription(): Promise<boolean> {
    try {
      console.log('\nTesting get subscription...')

      const deviceToken = 'test-device-token-123'
      const response = await axios.get<SubscriptionInfo>(`${this.baseUrl}/subscription/${deviceToken}`)
      console.log('✅ Get subscription successful:', response.data)
      return true
    } catch (error) {
      console.error('❌ Get subscription failed:', this.getErrorResponse(error))
      return false
    }
  }

  async testListSubscriptions(): Promise<boolean> {
    try {
      console.log('\nTesting list subscriptions...')

      const response = await axios.get<SubscriptionListResponse>(`${this.baseUrl}/subscriptions`)
      console.log('✅ List subscriptions successful:', response.data)
      return true
    } catch (error) {
      console.error('❌ List subscriptions failed:', this.getErrorResponse(error))
      return false
    }
  }

  async testNotification(): Promise<boolean> {
    try {
      console.log('\nTesting notification...')

      const notificationData: TestNotificationRequest = {
        deviceToken: 'test-device-token-123',
        title: 'Test Notification',
        body: 'This is a test notification from the API',
        data: { test: true, timestamp: new Date().toISOString() },
      }

      const response = await axios.post<ApiResponse>(`${this.baseUrl}/test-notification`, notificationData)
      console.log('✅ Test notification sent:', response.data)
      return true
    } catch (error) {
      console.error('❌ Test notification failed:', this.getErrorResponse(error))
      return false
    }
  }

  async testUnsubscription(): Promise<boolean> {
    try {
      console.log('\nTesting unsubscription...')

      const unsubscriptionData = {
        deviceToken: 'test-device-token-123',
      }

      const response = await axios.post<ApiResponse>(`${this.baseUrl}/unsubscribe`, unsubscriptionData)
      console.log('✅ Unsubscription successful:', response.data)
      return true
    } catch (error) {
      console.error('❌ Unsubscription failed:', this.getErrorResponse(error))
      return false
    }
  }

  async testValidation(): Promise<boolean> {
    try {
      console.log('\nTesting validation...')

      // Test missing device token
      try {
        await axios.post(`${this.baseUrl}/subscribe`, {
          addresses: ['0x1234567890abcdef1234567890abcdef12345678'],
        })
        console.log('❌ Should have failed with missing device token')
      } catch (error) {
        const errorData = this.getErrorResponse(error)
        if (
          errorData &&
          typeof errorData === 'object' &&
          'code' in errorData &&
          errorData.code === 'MISSING_DEVICE_TOKEN'
        ) {
          console.log('✅ Correctly validated missing device token')
        } else {
          console.log('❌ Unexpected validation error:', errorData)
        }
      }

      // Test missing addresses
      try {
        await axios.post(`${this.baseUrl}/subscribe`, {
          deviceToken: 'test-token',
        })
        console.log('❌ Should have failed with missing addresses')
      } catch (error) {
        const errorData = this.getErrorResponse(error)
        if (
          errorData &&
          typeof errorData === 'object' &&
          'code' in errorData &&
          errorData.code === 'MISSING_ADDRESSES'
        ) {
          console.log('✅ Correctly validated missing addresses')
        } else {
          console.log('❌ Unexpected validation error:', errorData)
        }
      }

      return true
    } catch (error) {
      console.error('❌ Validation test failed:', this.getErrorMessage(error))
      return false
    }
  }

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Liberdus Notification Service Tests\n')

    const results: boolean[] = []

    results.push(await this.testHealthCheck())
    results.push(await this.testSubscription())
    results.push(await this.testGetSubscription())
    results.push(await this.testListSubscriptions())
    results.push(await this.testNotification())
    results.push(await this.testValidation())
    results.push(await this.testUnsubscription())

    const passed = results.filter((r) => r).length
    const total = results.length

    console.log(`\n📊 Test Results: ${passed}/${total} tests passed`)

    if (passed === total) {
      console.log('🎉 All tests passed!')
    } else {
      console.log('⚠️  Some tests failed. Check the output above.')
    }
  }

  private getErrorMessage(error: any): string {
    if (axios.isAxiosError(error)) {
      return error.message
    }
    return error instanceof Error ? error.message : 'Unknown error'
  }

  private getErrorResponse(error: any): ErrorResponse | string {
    if (axios.isAxiosError(error)) {
      return error.response?.data || error.message
    }
    return error instanceof Error ? error.message : 'Unknown error'
  }
}

// Add axios dependency check
async function checkDependencies(): Promise<boolean> {
  try {
    // axios is already imported, so if we get here it's available
    return true
  } catch (error) {
    console.log('📦 Installing axios for testing...')
    const { execSync } = require('child_process')
    try {
      execSync('npm install axios', { stdio: 'inherit' })
      console.log('✅ axios installed successfully')
      return true
    } catch (installError) {
      console.error('❌ Failed to install axios:', installError)
      console.log('Please run: npm install axios')
      return false
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const testClient = new NotificationTestClient()
  testClient.runAllTests()
}
